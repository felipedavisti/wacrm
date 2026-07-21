# Especificação de Feature: Motor de Leads — Núcleo (ingestão, roteamento, resiliência, reprocessamento)

**Feature Branch**: `008-multi-conta` (autoria conjunta das specs do programa; implementação em branch própria)

**Created**: 2026-07-20

**Status**: Draft

**Input**: Fusão da spec externa "Motor de Leads" (`motor-leads-speackit/specs/001-motor-de-leads`) ao CRM. Decisões do programa já fechadas: destino = o próprio CRM (mata Odoo), com **destino configurável por conta** (interno vs externo); stack do CRM (Next.js + Supabase/TS), **abandonando o Go**; resiliência via **outbox no Postgres + pgmq + pg_cron** (sem broker); empresa = `account` (fundação da [008-multi-conta]).

## Contexto e Problema

Cada lead pago tem custo de aquisição; uma falha silenciosa é dinheiro de mídia jogado fora. Hoje (no mundo externo do cliente) os leads chegam de origens distintas e a criação no CRM depende de automações cujo reprocessamento é manual. O objetivo é **centralizar a ingestão** dentro do próprio CRM: independentemente da porta de entrada, todo lead termina como registro rastreável e vira oportunidade na **empresa (account) correta**, com origem e campanha rastreáveis — e **nenhum lead se perde**.

Esta feature é o **núcleo** do programa Motor de Leads e depende da fundação multi-conta (008): "empresa" é um `account`; o roteamento entrega o lead ao account certo. Fica **fora** desta 009: a origem CTWA/WhatsApp (feature 010) e a recuperação ativa na Meta + alertas de formato (feature 011).

**Escopo de origens na 009**: **Site (formulário)** e **Meta Ads (lead form)**. CTWA é 010.

**Mudança-chave vs. a spec externa**: os destinos externos (Odoo, Chatwoot) somem. O destino padrão é **interno** — o lead cria um `contact` + um `deal` no pipeline do account. A camada de destino permanece **plugável** (abstração), configurável por conta, para permitir um destino externo no futuro sem reescrever o núcleo.

## Clarifications

### Session 2026-07-20

- Q1: "Praça" ainda existe? → A: **Não** — dropada como conceito de primeira classe. Empresa = `account` já dá o recorte (Salvador/São Luís são accounts distintos). Se um recorte adicional for preciso, vira tag/campo do lead, não primitiva do motor. (Some da FR-011 e do de-para.)
- Q2: O lead vira entidade nova ou reusa o CRM? → A: **Reusa o Funil + ledger de ingestão.** Um lead entregue vira um **`deal` (negócio) num `pipeline` (funil)**, com `contact` criado e vinculado (`deals.contact_id`) e os campos de rastreamento como **custom fields**. O CRM já tem `pipelines`/`pipeline_stages`/`deals`/`custom_fields` e suporta **vários funis por empresa** (funil de SDR, closer, vendas, suporte) — é só ampliar. Por baixo, o motor mantém um **ledger de ingestão** (evento bruto + status + tentativas) separado, que sustenta "nunca descartar" e o reprocessamento; ao entregar, o ledger referencia o `deal`/`contact` criados.
- Q3: O painel de leads é por empresa ativa ou console central? → A: **Por empresa ativa** — o painel de operação mostra os leads do account ativo; troca de empresa para ver outro (consistente com a 008, sem nova superfície cross-account).
- **Validação (2026-07-20)**: (B2) o **dedup do Site inclui `cpf`** (identificador mais forte) além de telefone+e-mail+produto em 24h. (B3) **Meta Lead Form está em uso** — o webhook `fb-leads` só traz IDs (`leadgen_id`/`form_id`/`ad_id`); os dados vêm da **Graph API** (fluxo `RECEBE LEADS`): `GET /{ad_id}` (campanha/adset/conta) + `GET /{leadgen_id}?fields=field_data,…` (nome/telefone/e-mail + perguntas) + `GET /{form_id}` (nome do form). Meta **roteia por `form_id`→empresa**. Os nomes dos campos do formulário **variam** entre versões (perguntas antigas vs novas) → caso real de alerta de formato (011). (B4) rastreamento em `deals.tracking JSONB`. **Template de boas-vindas do lead Meta Form (B3.1)**: diferente do CTWA (010) — onde a pessoa já mandou mensagem e há conversa —, no **formulário não existe conversa** (a pessoa só preencheu o form). Para engajar via WhatsApp + IA é preciso **iniciar** a conversa com um **template** (regra da janela de 24h, feature 005). Decisão: modelar como **opção configurável por conta** — "enviar template de boas-vindas ao criar um lead de formulário" (padrão **desligado** até o negócio decidir), reusando os templates (007) e respeitando a janela de 24h (005). Ao iniciar a conversa, o lead entra no fluxo da IA (automações, fora desta 009). Ver FR-047.
- **Sem n8n**: o site posta **direto** no nosso endpoint (o intermediário `lead_prd` do n8n é eliminado). O corpo é o conjunto de campos do formulário `nome, celular, telefone, email, cpf, data_nascimento, produto, filial, sexo, estado_civil` (sem o embrulho interno do n8n). Consequências: (a) **Site roteia por `filial` → empresa** (explícito, não por campanha — FR-011); (b) `cpf/data_nascimento/sexo/estado_civil` viram **custom fields** do contato (`cpf` é PII sensível — LGPD, Constituição I); (c) `produto` normaliza removendo o prefixo "Plano " para o dedup. Detalhe no contrato `contracts/http-ingest.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Lead de Meta Ads (Formulário) vira oportunidade no CRM com rastreamento (Priority: P1)

Como marketing, quero que um lead de formulário da Meta seja recebido, normalizado e criado como oportunidade **na empresa correta** com todos os identificadores de campanha, para atribuir custo e performance por campanha e criativo.

**Why this priority**: origem de maior custo de aquisição direta; perder ou criar sem rastreamento inviabiliza ROI de mídia.

**Independent Test**: enviar um evento de lead form de teste (assinado) e verificar no CRM a criação do lead/oportunidade com todos os campos de rastreamento e a empresa correta.

**Acceptance Scenarios**:

1. **Given** um lead form de campanha ativa, **When** o evento chega ao motor (assinatura válida), **Then** um lead é registrado com contato normalizado, origem "Meta Ads", meio "Tráfego Pago" e os 7 campos de rastreamento (FR-005), e uma oportunidade é criada no account correto.
2. **Given** um lead de campanha mapeada para a empresa X, **When** criado no CRM, **Then** pertence exclusivamente ao account X (isolamento da 008).
3. **Given** um lead recebido, **When** a criação da oportunidade falha, **Then** o lead permanece com status "Falha", payload bruto preservado e motivo visível — nunca descartado.
4. **Given** a reentrega do mesmo evento (mesmo ID do lead da Meta), **When** chega de novo, **Then** não duplica (idempotência absoluta pelo lead id).

---

### User Story 2 — Lead do formulário do site vira exatamente um lead (Priority: P1)

Como marketing, quero que envios do formulário do site gerem exatamente um lead no CRM, com dedup, sem duplicar a lógica das outras origens.

**Why this priority**: origem de volume alto, com o problema conhecido de duplicidade.

**Independent Test**: submeter o formulário do site (token válido) e verificar exatamente um lead por envio; reenvio dentro de 24h não duplica.

**Acceptance Scenarios**:

1. **Given** um envio válido do site (token compartilhado válido), **When** chega ao motor, **Then** exatamente um lead é criado, origem "Site".
2. **Given** um lead já criado do site, **When** chega novo envio com mesmo telefone + e-mail + produto em 24h, **Then** nenhum duplicado é criado; o envio duplicado é registrado e vinculado ao original.
3. **Given** novo envio do mesmo contato/produto após 24h, **When** chega, **Then** é tratado como lead novo.
4. **Given** um envio com token inválido, **When** chega, **Then** é rejeitado (não vira lead) e registrado para diagnóstico.

---

### User Story 3 — Operador reprocessa leads com falha, individual ou em lote (Priority: P1)

Como operação, quero filtrar "Somente falhas", entender o motivo e reenviar leads individualmente ou em lote, sem depender de ninguém técnico.

**Why this priority**: é o coração do valor — transformar falha silenciosa em falha visível e recuperável (ex.: CRM/destino instável por 10 min ≈ 50 leads represados).

**Independent Test**: provocar falhas controladas, selecionar os leads no painel e reenviar em lote; verificar criação e atualização de status.

**Acceptance Scenarios**:

1. **Given** leads com status "Falha", **When** o operador aciona "Reenviar" num lead, **Then** ele é reprocessado e o status atualizado.
2. **Given** múltiplas falhas selecionadas, **When** reenvia em lote, **Then** todas reprocessam e o painel reflete o resultado por lead.
3. **Given** um lead com falha, **When** o operador abre o detalhe, **Then** vê o payload bruto, o histórico de tentativas e o erro de cada uma.
4. **Given** "Somente falhas" com N falhas no filtro, **When** aciona "Selecionar todas as N", **Then** o reenvio cobre todas as do filtro, não só a página.
5. **Given** o mesmo lead acionado por dois operadores ao mesmo tempo, **When** o segundo inicia, **Then** o sistema impede envio duplicado simultâneo.

---

### User Story 4 — Roteamento campanha/origem → empresa, gerenciável (Priority: P1)

Como Marketing/Tráfego pago, quero um cadastro de-para (campanha/origem → empresa) que a operação mantém, para que cada lead caia no account certo; campanhas sem mapeamento viram pendência visível, nunca perda.

**Why this priority**: sem o roteamento resolvido o lead não sabe a que empresa pertence; é pré-condição do destino.

**Independent Test**: cadastrar uma regra campanha→empresa, enviar um lead dessa campanha e verificar a empresa; enviar um de campanha sem regra e verificar a pendência de roteamento.

**Acceptance Scenarios**:

1. **Given** uma regra campanha X → empresa A, **When** um lead da campanha X chega, **Then** o lead é roteado para A antes da entrega.
2. **Given** um lead de campanha sem de-para, **When** chega, **Then** fica com "pendência de roteamento" visível no painel — não é entregue nem descartado — até a regra ser cadastrada.
3. **Given** a operação edita o de-para, **When** salva, **Then** vale para os próximos leads sem intervenção técnica.

---

### User Story 5 — Destino configurável por conta (interno vs externo) (Priority: P2)

Como administrador, quero configurar, por empresa, para onde os leads vão — o **CRM interno** (padrão) ou um **destino externo** — para usar a plataforma como motor+CRM ou como motor puro.

**Why this priority**: é o que preserva a dupla função do produto; o valor primário (não perder lead) já vem das P1 com o destino interno.

**Independent Test**: com o destino interno, verificar a criação de contato/oportunidade; trocar para um destino externo (stub) e verificar que a entrega passa a ir para ele, sem mudar o núcleo.

**Acceptance Scenarios**:

1. **Given** uma empresa com destino "interno" (padrão), **When** um lead é roteado para ela, **Then** um `contact` + `deal` são criados no account.
2. **Given** uma empresa com destino "externo" configurado, **When** um lead é roteado, **Then** a entrega é feita ao destino externo pelo mesmo mecanismo de outbox/retry, sem alterar ingestão/normalização.
3. **Given** troca de destino de uma empresa, **When** salva, **Then** vale para os próximos leads; o núcleo (ingestão/resiliência) é o mesmo.

---

### User Story 6 — Gestor acompanha a operação de leads (Priority: P2)

Como gestor, quero um painel com o volume do dia por origem e por empresa, a taxa de falha e o status de cada lead, para agir rápido quando algo foge do padrão.

**Why this priority**: dá visibilidade contínua; o valor primário (não perder lead) já é entregue pelas P1.

**Independent Test**: popular leads de múltiplas origens/status e validar totalizadores e filtros.

**Acceptance Scenarios**:

1. **Given** o painel aberto, **When** novos leads são processados, **Then** os indicadores (total do dia, por origem, falhas e %, empresas ativas) refletem em tempo quase real.
2. **Given** filtros combinados (origem + empresa + status + período), **When** aplicados, **Then** listagem e totalizadores respeitam todos simultaneamente.

---

### Edge Cases

- **Destino indisponível durante pico**: leads acumulam com status pendente/falha e são recuperados em lote quando volta — nenhum descarte.
- **Lead sem telefone/e-mail válido**: registrado de qualquer forma; a invalidade é erro reprocessável ou pendência, nunca descarte silencioso.
- **Campanha sem de-para**: pendência de roteamento visível, não perda.
- **Retry da Meta com mesmo lead id**: nunca duplica (idempotência).
- **Mesmo contato, mesmo formulário Meta, duas vezes**: não duplica; o 2º vira evento suprimido vinculado ao original. Formulários diferentes ⇒ leads distintos.
- **Reprocessamento acionado 2x pelo mesmo lead**: impede envio duplicado simultâneo (lock).
- **Agência cria campanha/criativo novo sem avisar**: a ingestão continua; identificadores chegam no evento e são entregues; sem de-para vira pendência de roteamento — nunca perda.

## Requirements *(mandatory)*

### Functional Requirements

**Ingestão e origem**

- **FR-001**: O sistema DEVE receber leads de duas origens na 009 — **Site** (formulário) e **Meta Ads** (lead form) — por pontos de entrada distintos e identificados por origem. (CTWA é 010.)
- **FR-002**: A origem DEVE ser explícita (determinada pelo ponto de entrada), nunca inferida por heurística sobre o conteúdo.
- **FR-003**: O sistema DEVE permitir adicionar novas origens (CTWA, Google Ads, TikTok) sem alterar o comportamento das existentes.
- **FR-004**: O sistema DEVE preservar o **payload bruto** original de todo evento recebido, mesmo quando a normalização ou a entrega falharem.
- **FR-005**: Para leads de mídia Meta, o sistema DEVE capturar e entregar os campos de rastreamento (reconstruídos dos campos `ink_new_*` do Odoo, agora como campos do lead/oportunidade no CRM): Campanha (utm.campaign), UTM da campanha, ID da Campanha, ID do lead (Meta), ID do formulário, ID do Criativo, Criativo — **7 campos** no formulário (6 no CTWA, feature 010). Ausência de dado esperado vira pendência sinalizada, nunca ignorada.
- **FR-006**: Além do rastreamento, o lead DEVE conter contato normalizado (nome, telefone, e-mail), Origem, Meio e Empresa.
- **FR-037**: Cada ponto de entrada DEVE **autenticar** a origem antes de aceitar: eventos da Meta com **assinatura do webhook validada** (X-Hub-Signature) + verify token; eventos do Site com **token/secret compartilhado** válido. Evento que falhar na validação DEVE ser rejeitado (não vira lead) e registrado para diagnóstico.

**Normalização e persistência (nunca descartar)**

- **FR-008**: O sistema DEVE normalizar todo lead para um **modelo canônico único**, independente da origem, com: contato, origem, campanha/rastreamento, empresa, status, nº de tentativas e histórico de erros.
- **FR-009**: O sistema DEVE registrar todo lead recebido em base própria (ledger), para auditoria e reprocessamento, **antes** de qualquer tentativa de entrega.
- **FR-010**: O sistema NÃO DEVE descartar leads em nenhuma condição de erro. Todo lead recebido DEVE ser rastreável até um status final.

**Roteamento por empresa**

- **FR-011**: O sistema DEVE resolver a **Empresa (account)** de cada lead a partir de um **de-para gerenciável**, antes da entrega, pela chave natural da origem: **Site → por `filial`** (o formulário já envia a filial, ex.: "São Luís" → account "Vitalmed São Luís"); **Meta → por `form_id`** (cada formulário pertence a uma filial/empresa — o mapaFilial atual: `form_id → SSA/FSA/LNAP`). Sem correspondência → pendência de roteamento (fila central), nunca perda.
- **FR-012**: O de-para DEVE ser consultável e atualizável pela operação, sem intervenção técnica (responsável: Marketing/Tráfego pago).
- **FR-013**: Todo dado do motor (leads, tentativas, histórico) DEVE ser segregado por empresa (reusa o RLS/`is_account_member` da 008). O painel respeita o recorte por empresa.

**Entrega ao destino (plugável, por conta)**

- **FR-014**: O destino **padrão é interno**: a entrega cria/atualiza um `contact` e cria um **`deal` (negócio) num `pipeline` (funil)** da empresa correta, vinculando o contato (`deals.contact_id`), com os campos de rastreamento (FR-005) gravados como **custom fields**. Reusa a área de Funil existente (`pipelines`/`pipeline_stages`/`deals`/`custom_fields`), que já suporta **vários funis por empresa** (ex.: SDR, closer, vendas, suporte). Um lead entregue **é** um deal no funil; o ledger de ingestão (FR-009) passa a referenciá-lo.
- **FR-015**: O de-para de roteamento (FR-011) DEVE poder resolver, além da empresa, o **funil-alvo** (pipeline) e o **estágio inicial** do deal; quando a regra não especificar, o lead cai num **funil de entrada padrão** da empresa. Isso viabiliza "cada função tem seu funil" (SDR/closer/vendas/suporte).
- **FR-047**: O sistema DEVE oferecer, **por conta**, uma opção (padrão **desligada**) de **enviar um template de boas-vindas por WhatsApp ao criar um lead de formulário Meta**, para iniciar a conversa (a janela de 24h exige template para mensagem iniciada pelo negócio — feature 005) e assim engajar o lead no fluxo de IA (automações). Reusa o envio de templates (007). Quando desligada, o lead é criado normalmente e nenhuma mensagem é enviada. A lógica de IA que conduz a conversa é do módulo de automações (fora desta 009).
- **FR-036**: A entrega DEVE ser tratada como **adaptador substituível**, **configurável por conta** (interno vs externo). Adicionar/trocar destino DEVE ser configuração, sem alterar o núcleo de ingestão/normalização/persistência/resiliência. A camada de resiliência (retry, reprocessamento, "nunca descartar", status por perna) é compartilhada por qualquer destino.

**Resiliência com idempotência**

- **FR-016**: Em falha de entrega, o sistema DEVE **retentar automaticamente** até 5 tentativas com backoff exponencial (≈ 1min, 5min, 15min, 1h, 3h), registrando cada tentativa com data/hora e motivo; esgotadas, o lead fica "Falha" para reenvio manual. O mecanismo é **outbox no Postgres + fila (pgmq) + agendador (pg_cron)** — sem broker externo.
- **FR-018**: Reentrega do mesmo evento Meta (mesmo lead id) NÃO DEVE nunca duplicar (idempotência absoluta pelo lead id).
- **FR-017**: Site: mesmo **`cpf`** (ou telefone + e-mail) + produto de um lead existente **em 24h** NÃO DEVE criar duplicado. Após 24h, lead novo. (O `cpf` entra como chave de dedup por ser o identificador mais forte — B2.)
- **FR-019**: Meta: mesmo contato no mesmo formulário não duplica; em formulários diferentes gera leads distintos.
- **FR-020**: Todo evento suprimido por dedup DEVE ser registrado e consultável (vínculo ao lead original) — deduplicar nunca é descartar em silêncio.

**Operação e reprocessamento (interface visual)**

- **FR-027**: A operação DEVE listar leads com status (Enviado, Falha, Pendente, e — quando houver múltiplos destinos — Parcialmente enviado), com filtros combináveis por origem, status e período. O painel é **escopado pela empresa ativa** (Q3) — mostra os leads do account ativo; troca de empresa para ver outro.
- **FR-028**: A operação DEVE reprocessar leads individualmente e em lote, incluindo "selecionar todas as falhas do filtro", impedindo envio duplicado simultâneo do mesmo lead.
- **FR-029**: A operação DEVE visualizar, por lead, o payload bruto e o log de erro de cada tentativa.
- **FR-030**: O painel DEVE exibir indicadores do dia: total, volume por origem, falhas (quantidade e %), empresas ativas.
- **FR-033**: O acesso à operação DEVE ser restrito e escopado por empresa (papéis da 008); nada de dado de empresa fora de vínculo.

**Estado de entrega e retenção**

- **FR-034**: Quando uma empresa tiver mais de um destino aplicável (ex.: interno + externo), e só um tiver sucesso, o sistema DEVE marcar "Parcialmente enviado", com status por destino e reprocessamento independente da perna. (Com destino único, o estado não se aplica.)
- **FR-035**: O sistema DEVE reter payloads brutos e histórico por tempo indefinido (sem expiração nesta fase), respeitando a LGPD (Constituição I).

### Key Entities *(include if feature involves data)*

- **Lead (canônico / ledger)**: representação única independente da origem — contato, origem, rastreamento, empresa, status, tentativas, payload bruto, carimbos. É o registro de resiliência do motor (distinto do `contact`/`deal` criados no destino).
- **Evento bruto (raw event)**: payload cru imutável por evento (FR-004); suprimidos por dedup vinculam ao lead original.
- **Origem**: canal de entrada (Site, Meta Formulário; CTWA/futuras). Explícita pelo ponto de entrada.
- **Destino**: alvo plugável por conta (CRM interno; externo no futuro). Cada destino tem status por lead.
- **Deal / Funil (destino interno)**: `deal` num `pipeline` — o lead entregue **é** um negócio no funil, com contato vinculado e rastreamento em custom fields. Reusa as entidades existentes; vários funis por empresa (SDR/closer/vendas/suporte).
- **Empresa (account)**: dona do lead (fundação 008). O de-para roteia o lead para ela.
- **Tentativa de Envio**: registro append-only de cada tentativa a um destino (resultado + erro).
- **De-para Campanha/Origem → Empresa (+ funil/estágio)**: cadastro operacional gerenciável (FR-011/012/015).
- **Config de destino por conta**: escolha interno/externo por empresa (FR-036).

## Success Criteria *(mandatory)*

- **SC-001**: 100% dos leads recebidos são rastreáveis no painel até um status final — zero perdidos em silêncio.
- **SC-002**: 100% dos leads de mídia Meta chegam ao CRM com todos os campos de rastreamento aplicáveis preenchidos quando presentes no evento (7 no formulário).
- **SC-003**: Num incidente com 50 leads represados, a operação recupera 100% do lote em uma única ação de reenvio, em minutos.
- **SC-004**: Um operador identifica falhas, entende o motivo e reenvia em menos de 2 minutos, sem acionar o time técnico.
- **SC-005**: Uma nova origem/destino entra em operação sem indisponibilidade nem regressão nas existentes.
- **SC-006**: Os indicadores do painel refletem a operação em tempo quase real (≤ 30s).
- **SC-007**: Campanhas sem mapeamento aparecem como pendência visível em até 1 ciclo de atualização.
- **SC-008**: Zero duplicados no CRM segundo as regras (Site: telefone+e-mail+produto em 24h; Meta: mesmo lead id ou mesmo contato no mesmo formulário) — e 100% dos suprimidos rastreáveis.
- **SC-011**: Trocar/adicionar destino (interno↔externo) é feito por configuração, sem alterar o núcleo nem regredir origens/destinos existentes.

## Assumptions

- Empresa = `account` (fundação 008); o RLS/`is_account_member` já segrega os dados por empresa.
- Destino padrão interno = criar/atualizar `contact` + criar `deal` num funil. O funil/estágio-alvo vem do de-para (FR-015); sem regra específica, cai num **funil de entrada padrão** do account. A distribuição interna fina (round-robin de SDR, movimentação de etapas) permanece manual/como está, fora do motor.
- "Praça" foi **dropada** (Q1): empresa = account já dá o recorte; recortes extras viram tag/campo do lead.
- Os 7 campos de rastreamento reusam a infra de **custom fields** existente (não se criam colunas dedicadas por campo).
- Volume baixo (~milhares de leads no total); outbox no Postgres + pgmq + pg_cron satisfaz sem broker.
- Frescor do painel por consulta periódica (long polling) que satisfaça ≤ 30s; sem streaming/push.
- Campos `ink_new_*` são reconstruídos como campos do lead/oportunidade no CRM (não há mais Odoo).
- LGPD: PII e payloads brutos retidos em claro, protegidos pelo acesso restrito por empresa (Constituição I); anonimização/criptografia de campo fica como decisão futura, não bloqueia.

## Fora de Escopo (da 009)

- **CTWA / WhatsApp** como origem (captura de referral + criação sob demanda) — **feature 010**.
- **Recuperação ativa na Meta** e **alertas de mudança de formato** — **feature 011**.
- Deduplicação entre origens (fica por conta da identidade do contato no CRM).
- Qualificação/pontuação/enriquecimento de leads; distribuição interna (round-robin de SDR).
- Novas origens além de Site e Meta Form (a arquitetura permite; não construídas aqui).

## Dependências

- **008-multi-conta**: empresa = account; RLS por `is_account_member`; destino por conta ancora no account.
- Supabase com extensões **pgmq** e **pg_cron** habilitadas (fila + agendador do outbox).
- Acesso de integração à Meta (Graph API) para os leads de formulário; app secret/verify token (reusa o modelo de `meta_apps`/webhook da 007).
- Fornecimento do de-para inicial campanha→empresa pela área de negócio.
