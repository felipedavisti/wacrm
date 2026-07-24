# Tarefas: Observabilidade e Operação (013)

Origem: discussão com o PO em 2026-07-24 sobre garantia de entrega, e auditoria
de escala do mesmo dia (achados 9 e 10).

**Legenda**: `[P]` = paralelizável com as vizinhas.

---

## Phase 1: As falhas que parecem sucesso

### US1 — Worker vivo (P1)

- [ ] **T001** Migration: tabela de heartbeat de instância (identificador,
  última rodada, resultado, contadores).
  *Achado 9 — hoje `startLeadsWorkerLoop` loga na inicialização
  (`worker-loop.ts:83-86`) e depois só quando `claimed > 0` (`:56`). Laço morto
  por exceção, ou instância sem a variável de ambiente, é **invisível**.*
  (FR-058)

- [ ] **T002** Gravar o heartbeat a cada tique, inclusive quando não há
  trabalho — é justamente o tique vazio que prova que está vivo.
  (FR-058)

- [ ] **T003** Distinguir "falhou ao reivindicar" de "não havia trabalho".
  *Achado 9 — `runWorkerTick` engole erro de claim (`worker.ts:54-57`) e
  retorna `{claimed:0}`, idêntico ao caso saudável.* (FR-060)

- [ ] **T004** Exibir no painel de leads: última rodada, e sinalização quando
  passar do limite.
  (FR-059, SC-OBS-1)

- [ ] **T005** Mostrar **por instância**, não só "alguém rodou" — o cenário de
  config drift (uma instância sem a variável) só aparece assim.
  (FR-059, SC-OBS-4)

- [ ] **T006** [P] Teste: sem tique além do limite → interface sinaliza;
  religar → volta ao normal.

### US2 — Endpoint de saúde (P1)

- [ ] **T007** Criar o endpoint **fora do matcher do middleware**.
  *Achado 9 — não existe nenhum health/readyz nas 70 rotas. Hoje o balanceador
  sondaria uma rota que passa pelo middleware e chama `supabase.auth.getUser()`
  (`middleware.ts:26`) a cada verificação. Auth lento → sonda estoura → **todas**
  as instâncias saem do pool juntas.* (FR-061)

- [ ] **T008** Verificar dependência real (acesso ao banco) — responder 200
  só porque o processo está de pé é sonda que mente.
  (FR-062)

- [ ] **T009** Incluir identificador da instância e estado do worker; **não**
  incluir segredo, versão de dependência nem dado de cliente.
  (FR-063)

- [ ] **T010** [P] Teste: Auth fora → endpoint responde; banco fora → reporta
  não saudável.
  (SC-OBS-2)

### US3 — Rastro de ponta a ponta (P1)

- [ ] **T011** Identificador de instância vindo do ambiente, disponível a todo
  o servidor.
  *Achado 10 — o único identificador de processo hoje é `process.pid` em
  `worker.ts:41`, e **PIDs colidem entre containers**.* (FR-065)

- [ ] **T012** Identificador de correlação gerado no middleware e propagado —
  inclusive ao trabalho assíncrono.
  *Achado 10 — zero instrumentação no middleware; `randomUUID` aparece 4 vezes
  e nenhuma como id de requisição.* (FR-064)

- [ ] **T013** Ajudante de log estruturado (nível, instância, correlação,
  contexto), sem dependência externa.
  *Achado 10 — 284 chamadas `console.*` em texto livre, sem módulo de logging.*
  (FR-065, FR-069)

- [ ] **T014** Migrar os caminhos críticos primeiro: webhook de WhatsApp,
  ingestão de leads, worker. **Não** os 284 de uma vez.
  (FR-065)

- [ ] **T015** Registrar conclusão do trabalho assíncrono.
  *Achado 10 — o trabalho roda em `after()` e o único sinal de que terminou é
  a ausência de erro no log.* (FR-064)

- [ ] **T016** [P] Teste: um evento é rastreável por um identificador único do
  início ao fim.
  (SC-OBS-3)

---

## Phase 2: Superfície e aviso

### US4 — Tela de eventos rejeitados (P2)

- [ ] **T017** Rota de leitura de `lead_rejected_events`, restrita a owner
  (mesmo critério do painel de leads, que expõe PII).
  (FR-066)

- [ ] **T018** Tela com origem, motivo, momento e o que foi tentado.
  *A tabela existe e é populada desde a 009 (`ingest.ts:28`); nunca teve tela.
  Ali convivem configuração quebrada e tentativa de forjar lead — coisas muito
  diferentes.* (FR-066)

- [ ] **T019** Tratar o payload exibido conforme a LGPD: é dado de terceiro que
  **não** foi aceito no sistema.
  *Constituição I.* (FR-066)

- [ ] **T020** [P] Teste: rejeição por token e por assinatura aparecem, com o
  motivo correto.
  (SC-OBS-5)

### US5 — Alertas (P2)

- [ ] **T021** Decidir o canal de saída do alerta. **Bloqueia T022.**
  *Em aberto na spec; existe WhatsApp e n8n na casa.*

- [ ] **T022** Detectar e emitir: worker parado, taxa de falha acima do normal.
  (FR-067)

- [ ] **T023** Agrupar contra enxurrada — mesmo raciocínio dos alertas de
  formato da 011: 300 alertas idênticos numa quinta-feira e ninguém lê mais
  nenhum.
  (FR-067)

- [ ] **T024** Sinal de recuperação. Sem ele ninguém sabe se ainda está
  quebrado.
  (FR-067)

- [ ] **T025** Garantir que falha ao alertar **nunca** derruba entrega.
  (FR-069, SC-OBS-6)

---

## Phase 3: Métrica de produto

### US6 — Latência ponta a ponta (P3)

- [ ] **T026** Medir chegada → negócio criado.
  (FR-068)

- [ ] **T027** Exibir no painel junto dos indicadores atuais.
  (FR-068)

- [ ] **T028** Revisão de segurança da feature — com atenção ao endpoint de
  saúde (público por natureza) e ao que a tela de rejeitados exibe.

---

## Dependências entre fases

- **Phase 1** é pré-requisito da escala horizontal (o endpoint de saúde) e das
  outras fases (não se alerta sobre sinal que não existe).
- Dentro da Phase 2, T021 bloqueia T022.
- **Phase 3** só faz sentido com a operação estável.

## O buraco que esta spec NÃO fecha

Registrado porque foi levantado pelo PO e a decisão foi consciente:

O espelho do n8n usa `onError: continueRegularOutput` — se o CRM estiver fora, o
nó falha em silêncio, o lead entra no Chatwoot normalmente e **nunca existe para
nós**. Sem registro em lugar nenhum.

Não é defeito do espelho: é a consequência inevitável de "não pode derrubar
produção". Mitigação parcial já entregue: a recuperação ativa (011) reconcilia
leads de formulário contra a Meta — cobre o maior volume, mas **não** cobre site
nem CTWA.

Fechar de verdade exige trabalho **no fluxo do n8n** (registrar a tentativa que
falhou), não no CRM. Fica anotado como item de integração, fora desta spec.
