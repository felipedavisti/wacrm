# Fase 0 — Pesquisa & Decisões

Feature: Múltiplos números por conta (`007-multi-numero`).

As decisões de produto (6) já estavam tomadas e estão na spec e em
`docs/spec-multi-numero.md`. As decisões técnicas abaixo consolidam o "como".

## Decisão 1 — `meta_apps` (App Secret no nível do App)

**Decisão**: o app_secret/verify_token/app_id pertencem ao **Meta App**, não ao
número. Tabela `meta_apps` (por conta) + `whatsapp_config.meta_app_id`. Sai do
`.env`. Rotação de secret = update em 1 linha.

**Justificativa**: guardar por número duplicaria o secret em N linhas. O
`verify_token` por config que já existe passa a fazer sentido no multi-app.

## Decisão 2 — Webhook: try-all-secrets

**Decisão**: `verifyMetaWebhookSignature` passa a receber os app_secrets
distintos (de `meta_apps`, cacheáveis) e testa o HMAC contra cada um até bater,
**antes** de parsear o corpo. Mantém fail-closed. Mesmo padrão do GET (verify
tokens).

**Justificativa**: a identidade (`phone_number_id`) está no corpo não-confiável;
try-all-secrets evita parsear antes de autenticar e não indexa query por input
do atacante. Ver a seção "Autenticação do webhook (multi-app)" do doc.

## Decisão 3 — Costura `resolveConfig` por conversa (depende da 001)

**Decisão**: a 001 isolou a resolução de config numa costura. Aqui, trocar
`resolveConfigByAccount` por `resolveConfigByConversation` (usa
`conversations.whatsapp_config_id`). **Um** ponto muda; os motores herdam.

**Justificativa**: é exatamente o retorno estratégico projetado na 001. Se a 001
não estiver mergeada, ela é pré-requisito desta.

## Decisão 4 — Índice de dedupe de conversa

**Decisão**: `(account_id, contact_id)` → `(account_id, contact_id,
whatsapp_config_id)`. A resolução de conversa no webhook passa a considerar o
número. **Risco central**: sem isso, threads de dois números fundem em silêncio.

## Decisão 5 — Templates e broadcast por WABA/número

**Decisão**: `message_templates.waba_id` (sync + seletor por WABA);
`broadcasts.whatsapp_config_id` (passo de número no wizard, antes do template).

## Ordem recomendada

1. `meta_apps` + webhook multi-app (US3) — desbloqueia o 2º App.
2. `whatsapp_config` N por conta (US1) — cadastro.
3. `conversations.whatsapp_config_id` + índice + resolveConfig por conversa (US2).
4. Templates por WABA (US4).
5. Broadcast + saída fria (US5/US6).

## Referência

Design detalhado (schema, ~13 call sites, riscos, mudanças de UI):
**`docs/spec-multi-numero.md`**.
