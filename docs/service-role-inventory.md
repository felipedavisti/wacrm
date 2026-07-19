# Inventário dos caminhos `service_role`

Este documento operacionaliza o **Princípio II** da constituição (Segurança é a
camada de autorização). O cliente `service_role` **ignora a RLS**, então o
isolamento entre contas nesses caminhos depende de o código filtrar por
`account_id` — ou de um invariante documentado que o torne seguro.

> **Regra (FR-001/FR-006):** todo query feito com o cliente `service_role` DEVE
> filtrar por `account_id`, OU documentar aqui o invariante que o torna seguro.
> Um novo caminho `service_role` sem uma dessas duas coisas é um defeito que
> bloqueia o merge. Ao adicionar/alterar um caminho, atualize esta tabela.

Referência de tenancy: `account_id NOT NULL` + RLS via `is_account_member`
(migration 017). Invariantes auxiliares citados abaixo: `phone_number_id` único
(013), `message_id` **não** único entre contas (009).

## Fábricas do cliente

`src/lib/flows/admin-client.ts`, `src/lib/automations/admin-client.ts`,
`src/lib/ai/admin-client.ts` — fábricas idênticas (`createClient(URL,
SERVICE_ROLE_KEY)`), sem queries. O webhook e `whatsapp/config` têm cópias
inline da mesma fábrica.

## Bibliotecas (engines / envio / auth)

| Caminho | Veredito | Invariante / escopo |
|---|---|---|
| `whatsapp/engine-send-base.ts` | ✅ Escopado | contato `.eq('id').eq('account_id')`; config `resolveConfigByAccount` `.eq('account_id')`; inserts de `messages`/`conversations` por `conversation_id` (herdado do caller account-scoped) |
| `flows/meta-send.ts`, `automations/meta-send.ts` | ✅ Escopado | delegam a `sendFromEngine` com `accountId` explícito |
| `whatsapp/send-message.ts` | ✅ Escopado | conversation/config/templates/parent todos `.eq('account_id')`; pause de `flow_runs` `.eq('account_id')` |
| `flows/engine.ts` | ✅ Escopado | `accountId` do webhook; run/flow/inbound `.eq('account_id')`; demais por id de run/flow já account-scoped |
| `automations/engine.ts` | ✅ Escopado | guard de posse do contato no entrypoint (`runAutomationsForTrigger`); steps `.eq('account_id')` |
| `ai/auto-reply.ts` | ✅ Escopado | `accountId` do webhook; config/knowledge/automations `.eq('account_id')`; conversa por `conversationId` account-scoped |
| `auth/api-context.ts` | ✅ Invariante | API key fixa a conta (`accountId = row.account_id` do hash) |
| `api-keys/store.ts` | ✅ Invariante | o hash da key **é** a credencial que estabelece a conta; lookups por id já resolvido |
| `automations/steps-tree.ts` | ⚠️ **Sem escopo próprio** | opera em `automation_steps` só por `automation_id` (tabela sem `account_id`). Seguro **apenas** porque todo caller valida posse antes. Ver "Pontos frágeis" |

## Rotas de API

| Rota | Veredito | Invariante / escopo |
|---|---|---|
| `whatsapp/webhook/route.ts` | ✅ Invariante (1 ressalva) | conta por `phone_number_id` único (013); inserts carimbam `account_id`. **Ressalva:** `handleStatusUpdate` — ver "Pontos frágeis" |
| `whatsapp/webhook-auth.ts` (`loadWebhookAppSecrets`) | ✅ Cross-account **por design** | lê `meta_apps.app_secret` de TODAS as contas para autenticar o webhook (o POST pode ser de qualquer número/App). Leitura service_role deliberada e correta — os secrets ficam no servidor, nunca são retornados; a auth falha fechada. Spec 007. |
| `whatsapp/config/route.ts` | ✅ Escopado | quase tudo via cliente RLS; service_role só no check anti-colisão de `phone_number_id` (leitura cross-account **intencional**, não exposta ao cliente) |
| `automations/cron/route.ts` | ✅ Invariante | segredo `x-cron-secret` (timing-safe); linhas pending já carimbadas por conta; downstream escopa por `automation.account_id` |
| `flows/cron/route.ts` | ✅ Invariante | segredo; varredura global é o objetivo; escrita de timeout por `.eq('id', run.id)` |
| `automations/route.ts` | ✅ Escopado | GET via RLS; POST `requireRole` + insert com `account_id` |
| `automations/[id]/route.ts` | ✅ Escopado | posse por `.eq('user_id', user.id)` (mais estrito que account) |
| `automations/[id]/duplicate/route.ts` | ✅ Escopado | original lido `.eq('user_id')`; clone com `original.account_id` |
| `flows/route.ts` | ✅ Escopado | GET via RLS; POST `requireRole` + insert com `account_id` |
| `flows/[id]/route.ts` | ✅ Invariante | pré-check via SELECT RLS (`is_account_member`) antes das mutações admin por `.eq('id')` |
| `flows/[id]/activate/route.ts` | ✅ Invariante | mesmo pré-check RLS account-scoped |
| `quick-replies/route.ts` | ✅ Escopado | GET via RLS; POST insert com `account_id` |
| `quick-replies/[id]/route.ts` | ✅ Escopado | PATCH/DELETE `.eq('id').eq('account_id')` |
| `ai/draft/route.ts` | ✅ Escopado | leituras via RLS; service_role só no `logAiUsage` carimbado com `accountId` da sessão |

## Pontos frágeis (backlog de hardening)

1. **`automations/steps-tree.ts`** — `replaceSteps`/`insertSteps`/`loadStepsTree`
   operam em `automation_steps` só por `automation_id`, sem `account_id` (a
   tabela não tem a coluna). Seguro **hoje** porque todos os callers (rotas de
   automations) validam posse por `user_id` antes. É o ponto mais frágil: um
   novo caller que esqueça o check vaza entre contas. **Recomendação:** exigir/
   verificar posse dentro da própria função (ou receber e assertar `accountId`).

2. **`whatsapp/webhook/route.ts` → `handleStatusUpdate` (~L363)** —
   `messages.update({ status }).eq('message_id', status.id)` **sem escopo de
   conta**. Como `message_id` **não** é único entre contas (009), um id
   colidente atualizaria o status de mensagem de outra conta. Só espelha status
   vindo da Meta (baixa severidade), mas é a única escrita cross-account sem
   invariante forte. **Recomendação:** escopar por conversa/conta da resolução
   do `phone_number_id`. Arquivo quente do upstream — mudança deliberada e
   documentada (Princípio V) antes de aplicar.

3. **`contact_tags` sem `account_id`** — deletes/leituras em `automations/
   engine.ts` e `flows/engine.ts` dependem do guard de posse do contato no
   entrypoint. Consistente e já comentado no código; manter o guard como
   invariante inegociável.
