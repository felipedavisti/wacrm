# Tarefas: Prontidão para Escala Horizontal (012)

Cada tarefa cita o achado da auditoria de 2026-07-24 que a originou, com
arquivo e linha. **Nada aqui é boas práticas genéricas** — tudo foi verificado
no código.

**Legenda**: `[P]` = paralelizável com as vizinhas.

---

## Phase 1: Bloqueantes — não subir N>1 sem isto

### US1 — Fluxo não responde duas vezes (P1)

- [ ] **T001** Migration: reivindicação de `flow_runs` antes do avanço.
  Adicionar comparação-e-troca sobre `current_node_key` (ou coluna de lease) de
  forma que dois processadores nunca avancem o mesmo run.
  *Achado 3.3 — `src/lib/flows/engine.ts:890` não faz claim algum; o índice
  `idx_one_active_run_per_contact` impede dois RUNS, não dois PROCESSADORES.*
  (FR-049)

- [ ] **T002** RPC atômica para capturar variável em `collect_input`:
  `vars = vars || jsonb_build_object(chave, valor)` no banco, em vez do spread
  em JS.
  *Achado 3.3 — `engine.ts:947` faz `{ ...run.vars, [key]: v }` a partir de
  leitura anterior; o comentário na linha 946 afirma "atomically" e é falso.*
  (FR-048, FR-049)

- [ ] **T003** RPC atômica para `reprompt_count` (incremento no banco).
  *Achado 3.3 — `engine.ts:997`.* (FR-048)

- [ ] **T004** Corrigir o comentário da linha 946 — ou ele descreve o código, ou
  sai. Comentário que afirma o oposto do comportamento é pior que ausência de
  comentário: leva o próximo leitor a não investigar.
  *Achado 3.3.*

- [ ] **T005** [P] Teste: duas mensagens concorrentes no mesmo run → uma
  avança, nenhuma variável perdida, um envio.
  *Validar por mutação: remover o claim e confirmar que o teste quebra.*
  (SC-ESC-2)

### US2 — Contadores corretos (P1)

- [ ] **T006** RPC atômica para `unread_count` e campos derivados da conversa.
  *Achado 3.1 — `src/app/api/whatsapp/webhook/route.ts:774`:
  `unread_count: (conversation.unread_count || 0) + 1`, com o valor lido bem
  antes, dentro do `after()`. O repositório já tem quatro exemplos do padrão
  correto a seguir.* (FR-048)

- [ ] **T007** Tornar `appendResults` atômico (append no banco, não
  leitura-modificação-escrita do array).
  *Achado 3.2 — `src/lib/automations/engine.ts:750-774`. Duas execuções
  pendentes com o mesmo `log_id` retomadas em instâncias diferentes perdem
  passos do histórico. Ironia: o comentário em `engine.ts:213-216`, na mesma
  função-mãe, explica exatamente por que RMW é errado.* (FR-048)

- [ ] **T008** [P] Teste: N mensagens concorrentes → `unread_count = N`.
  (SC-ESC-1)

### US3 — Limitador global (P1)

- [ ] **T009** Decidir o backend de contagem (Redis / Upstash / Postgres) e
  registrar a decisão com o porquê. **Bloqueia T010.**
  *Achado 1.1 — decisão em aberto na spec.*

- [ ] **T010** Trocar a implementação de `checkRateLimit` preservando
  `RateLimitResult`. Os **16 pontos de chamada não podem mudar** — a interface
  já foi desenhada para isso.
  *Achado 1.1 — `src/lib/rate-limit.ts:46,52`. Documentado em três lugares
  (`rate-limit.ts:9-14`, `docs/public-api.md:89-94`,
  `docs/funcionalidades.md:467`).* (FR-050)

- [ ] **T011** Definir e documentar o comportamento quando o backend está fora
  (fail-open vs fail-closed). Decisão explícita, nunca acidental.
  (FR-051)

- [ ] **T012** [P] Teste: limite respeitado com contagem compartilhada; e o
  caminho de indisponibilidade se comporta como decidido.
  (SC-ESC-3)

- [ ] **T013** Usar `CF-Connecting-IP` para as chaves por IP.
  *Achado 11.3 — `invitations/[token]/redeem/route.ts:34` pega
  `x-forwarded-for[0]`, que a Cloudflare **acrescenta** ao valor enviado pelo
  cliente: um atacante controla o índice 0. Combinado com o limitador por
  processo, o teto de resgate de convite (10/min) é contornável por duas vias
  independentes.* (FR-050)

### US4 — Desligamento não descarta trabalho (P1)

- [ ] **T014** Tratador de `SIGTERM` com janela de drenagem compatível com a
  duração máxima das rotas.
  *Achado 2.2 — **zero** ocorrências de `SIGTERM` no repositório. Todo o
  processamento de inbound roda em `after()`
  (`whatsapp/webhook/route.ts:223`) depois do 200 à Meta, que nunca reenvia.*
  (FR-052)

- [ ] **T015** Lease + recuperação para `automation_pending_executions` presas
  em `running`.
  *Achado 4 — `automations/cron/route.ts:49` marca `running` e só volta em
  `markPending`. Instância morta no meio deixa a linha travada **para sempre**;
  nenhum cron recupera. Já em `docs/funcionalidades.md:484`.* (FR-053)

- [ ] **T016** Recuperação de campanha interrompida (destinatários em
  `pending`, campanha presa em `sending`).
  *Achado 2.2 — `broadcast-core.ts:273` é um `for` sequencial; morrer no meio
  nunca executa o update terminal de `:325-331`. Reconhecido em
  `v1/broadcasts/route.ts:29-36` como "follow-up".* (FR-053, FR-057)

- [ ] **T017** `maxDuration` explícito nas rotas com trabalho longo.
  *Achado 11.1 e 4 — `automations/cron` drena até 50 execuções serialmente
  **dentro do request** e não declara `maxDuration`; `whatsapp/broadcast`
  idem. Atrás de um balanceador com timeout de 60s, o cron toma timeout, o
  agendador re-tenta, e o retry encontra tudo em `running` e pula.*

---

## Phase 2: Logo em seguida

### US5 — Status monotônico (P2)

- [ ] **T018** Guarda de monotonicidade no espelhamento de status.
  *Achado 3.4 — `src/lib/whatsapp/status-mirror.ts:65-69` faz `update({status})`
  sem cláusula de ordem. A proteção equivalente **já existe** para campanhas
  (`isValidStatusTransition`, `webhook/route.ts:357-369`) — falta para
  mensagens. Já em `docs/funcionalidades.md:463`.* (FR-054)

- [ ] **T019** [P] Teste: `read` antes de `delivered` → estado final `read`.
  (SC-ESC-6)

### US6 — Idempotência de mensagem (P2)

- [ ] **T020** Migration: índice único em `(conversation_id, message_id)` +
  `ON CONFLICT DO NOTHING` no insert.
  *Achado 8 — `001_initial_schema.sql:178` cria `idx_messages_message_id`
  **não-único**; `webhook/route.ts:742` insere sem `ON CONFLICT`. Reentrega da
  Meta noutra instância duplica a mensagem, o `unread_count`, o disparo de
  automação (**cliente recebe resposta automática duas vezes**) e o webhook de
  saída.* (FR-055)

- [ ] **T021** Tornar a checagem de duplicidade do motor de fluxos resistente a
  concorrência.
  *Achado 3.3 — `isDuplicateInbound` (`flows/engine.ts:287-311`) é TOCTOU: duas
  instâncias com o mesmo `meta_message_id` podem ambas ler zero antes de
  qualquer uma inserir.* (FR-055)

- [ ] **T022** [P] Teste: mesmo evento duas vezes em paralelo → uma mensagem,
  um disparo de gatilho.
  (SC-ESC-5)

---

## Phase 3: Higiene de escala

- [ ] **T023** Identificador de instância estável em `locked_by` do worker (o
  `process.pid` atual **colide entre containers**).
  *Achado 2.1 — `src/lib/leads/worker.ts:40-42`.*

- [ ] **T024** Verificar o `Cache-Control` que de fato sai da rota de mídia em
  produção (`curl -I`).
  *Achado 11.2 — `media/[mediaId]/route.ts:86` devolve `public, max-age=86400`
  numa rota **autenticada**, enquanto `next.config.ts:135-137` define
  `no-store` para `/api/:path*`. Se o `public` prevalecer, a Cloudflare cacheia
  por `mediaId` — que **não é escopado por conta**. Vazamento de mídia entre
  empresas no edge. **Investigar antes de tratar como bug ou como não-problema.**

- [ ] **T025** Procedimento de rotação de segredo com N instâncias.
  *Achado 1.2 — os seis clientes `service_role` são criados uma vez por
  processo; a chave é congelada até reiniciar. Sem invalidação, e sem health
  check não se sabe qual instância ainda usa a antiga. Pode ser só documento.*

- [ ] **T026** [P] Reduzir amplificação de escrita em `touchLastUsed`.
  *Achado 11.4 — `api-keys/store.ts:81-94` faz um `UPDATE` na mesma linha a
  cada requisição da API pública; com N instâncias vira contenção de row lock
  por valor que não importa.*

- [ ] **T027** Revisão de segurança e de código da feature.

---

## Dependências entre fases

- **Phase 1** é bloqueante para subir N>1. Dentro dela, T009 bloqueia T010.
- **Phase 2** pode ir depois do primeiro deploy multi-instância — as falhas já
  existiam com uma instância, só ficam mais frequentes.
- **Phase 3** é higiene; T024 pode virar urgente se a investigação confirmar o
  vazamento de cache.

## O que a auditoria confirmou estar CERTO

Registrado para não ser "corrigido" por engano:

- **Worker de leads** — `FOR UPDATE SKIP LOCKED` com lease. É o padrão de
  referência do repositório.
- **Crons de automações e fluxos** — o `UPDATE ... WHERE status='pending'` é
  atômico de verdade (o Postgres reavalia o predicado após o row lock). Melhor
  do que o próprio comentário do código admite.
- **Contadores de campanha** — propriedade de trigger no banco; o código
  deliberadamente não escreve.
- **Sem cache de segredo em memória** — `loadWebhookAppSecrets` consulta a cada
  requisição. Caro no caminho quente, mas zero divergência entre instâncias.
- **Sem escrita em disco** e **sem Realtime no servidor** — nada a fazer.
