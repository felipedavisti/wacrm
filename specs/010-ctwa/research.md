# Research — CTWA (Fase 0)

Reuso máximo do que já existe: webhook/inbox de WhatsApp (007) e o núcleo do motor
(009). A 010 é uma extensão **aditiva** de ambos.

## D1 — Captura de referral no webhook existente (007)

- **Decisão**: estender o handler de mensagens do webhook (007) para detectar o objeto
  `referral` na mensagem (tipicamente a 1ª da conversa) e persistir o vínculo em
  **`ctwa_referrals`** (wamid, conversation_id, campanha/adset/criativo/conta, url,
  ctwa_clid, raw). Reusa a validação de assinatura (fail-closed) — nada novo em auth.
- **Rationale**: o webhook já roda e já resolve a conversa por número/account (007);
  capturar o referral ali é o ponto natural. Mensagens sem `referral` são ignoradas
  para atribuição.

## D2 — Empresa do lead CTWA = account do número (sem de-para)

- **Decisão**: como a conversa CTWA chega num número que **pertence a um account**
  (007/008), a **empresa do lead já é conhecida** — é `conversation.account_id`. O
  `routing_map` (009, por campanha) **não é necessário** para CTWA. O referral serve à
  **atribuição** (rastreamento), não ao roteamento.
- **Consequência**: o lead CTWA nunca fica "pendente de roteamento" por empresa (a
  empresa é certa); pode ficar com **pendência de atribuição** se o referral for
  parcial (FR-007/US3).

## D3 — Criação automática e imediata, reusando o núcleo 009

- **Decisão**: ao capturar o referral (D1), criar **imediatamente** um
  `lead_ingestions` (009) com `source='meta_ctwa'`, `account_id` = account da conversa,
  `canonical` com os 6 campos de rastreamento; como contato e conversa **já existem**,
  a entrega interna (009 `deliver-internal`) cria apenas o **`deal`** no funil de
  entrada do account, vinculado ao contato/conversa. Passa pelo **outbox/resiliência**
  do 009 (nunca descartar, retry).
- **Funil-alvo**: funil de entrada padrão do account (ou um funil CTWA configurável por
  conta — reusa a config de 009). Detalhe de implementação.
- **Idempotência (FR-040)**: **um deal por conversa CTWA** — unique/guard por
  `conversation_id` no `lead_ingestions` (ou em `ctwa_referrals.lead_ingestion_id`).
  Novas mensagens/reentregas não criam segundo deal.

## D4 — Qualificação/atribuição por IA é automação posterior (fora da 010)

- O lead nasce no ato; a IA de SDR qualifica e atribui **depois**, via o módulo de
  automações/agentes, agindo sobre o lead já criado (FR-043). A 010 não implementa
  essa inteligência — só garante o lead imediato.

## Superfícies sensíveis (Constituição II)

- Extensão do webhook (007) — mantém fail-closed; não afrouxar a verificação de
  assinatura.
- Criação automática carimba o `account_id` da conversa — auditar isolamento (não
  criar deal na empresa errada).

## Numeração de migrations

009 vai até `515`. A 010 segue em **`516_`+**. Divergências documentadas (Princípio V).
