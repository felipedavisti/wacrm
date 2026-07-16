# Spec — Múltiplos números por conta

Status: **rascunho, aguardando revisão**
Escopo: mudança de axioma no modelo de dados. Não é feature isolada.

## Contexto

O sistema assume, em vários lugares, que **uma conta tem exatamente um
número de WhatsApp**. Esse axioma está gravado principalmente em índices
de unicidade e em chamadas `.single()` sobre `whatsapp_config`.

Nosso modelo de operação é diferente:

- **um deployment por cliente** (isolamento físico; a multi-tenancy do
  app protege os times dentro do cliente, não clientes entre si);
- **um cliente tem vários números**;
- **os números podem estar em Meta Apps diferentes**.

Este documento fixa o que "identidade" significa quando existem N números,
e o que muda em consequência.

## Decisões de produto

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Mesmo contato falando em 2 números | **Um único contato** (compartilhado) |
| 2 | Conversa em 2 números | **Threads separadas**, desacopladas (modelo de caixas do Chatwoot) |
| 3 | Resposta a uma conversa sai por qual número | **Pelo número em que chegou.** O agente não escolhe |
| 4 | Templates | **Por WABA.** O seletor filtra pela WABA do número |
| 5 | Broadcast | **Área geral do cliente.** O número é um campo do disparo |
| 6 | Saída fria (contato que nunca falou) | **O agente escolhe o número na hora** |

Consequência da #3 + #6: **existe exatamente um seletor de número em todo
o produto** — na criação de conversa fria. Em nenhum outro lugar o agente
escolhe por onde a mensagem sai.

Consequência da #1 + #2: o contato é global, as threads são por número.
Uma tela "geral" (broadcast) escreve dentro das caixas.

## Modelo de dados

Hierarquia real da Meta, que o schema atual não representa:

```
Meta App   (app_id, app_secret, verify_token)
   └── WABA
        └── número
```

### Novas tabelas

**`meta_apps`** — o App Secret e o verify token pertencem ao **App**, não
ao número. Guardá-los por número duplicaria o mesmo segredo em N linhas e
tornaria a rotação um update em N lugares.

```
meta_apps (
  id, account_id,
  app_id,
  app_secret     -- AES-256-GCM, mesma ENCRYPTION_KEY
  verify_token   -- AES-256-GCM
)
```

`whatsapp_config.meta_app_id` → FK para `meta_apps`.

### Alterações

| Tabela | Mudança | Motivo |
|---|---|---|
| `whatsapp_config` | dropar `UNIQUE(account_id)` | N números por conta |
| `whatsapp_config` | + `meta_app_id` FK | credenciais do app saem da env |
| `conversations` | + `whatsapp_config_id` NOT NULL | decisão #2 e #3 |
| `conversations` | índice `(account_id, contact_id)` → `(account_id, contact_id, whatsapp_config_id)` | **ver risco abaixo** |
| `message_templates` | + `waba_id` | decisão #4 |
| `broadcasts` | + `whatsapp_config_id` | decisão #5 |
| `flow_runs` | índice parcial de run ativa: incluir o número | mesma colisão de `conversations` |

O `UNIQUE(phone_number_id)` da migration 013 **permanece** — um número
pertence a uma config, globalmente. Está correto.

`contacts` **não muda** (decisão #1). O dedup por telefone da 022 continua
como está.

### Numeração das migrations

Usar a faixa **`500_`** em diante. O upstream numera sequencialmente e está
em `036`; a faixa reservada elimina colisão de nome e ambiguidade de ordem
em qualquer merge futuro.

## Autenticação do webhook (multi-app)

Hoje `verifyMetaWebhookSignature` (`src/lib/whatsapp/webhook-signature.ts:25`)
lê um único `process.env.META_APP_SECRET`. Com dois Meta Apps, todo evento
do segundo app é **rejeitado** — o número simplesmente não funciona.

A identidade do remetente (`phone_number_id`) está **dentro do corpo**, que
é justamente o que se quer autenticar. Para não parsear entrada não
confiável antes da autenticação, nem fazer query no banco indexada por
input do atacante:

```
carrega os app_secrets distintos de meta_apps   (2–3 linhas, cacheável,
                                                 iguais para toda requisição)
   ↓
HMAC do raw body contra cada um até bater
   ↓
bateu → parseia e roteia por phone_number_id (código atual, webhook/route.ts:256)
não bateu → 401
```

É o mesmo padrão que o GET já usa com os verify tokens
(`webhook/route.ts:122-132`).

**Preservar o fail-closed.** Nenhum secret bateu, ou nenhum app cadastrado
→ 401. Nunca "deixa passar porque não achei config". Uma versão anterior do
upstream falhava aberto e isso foi corrigido de propósito
(ver comentário em `webhook-signature.ts:15-19`).

`META_APP_ID` (`template-header-handle.ts:29`) sai da env pelo mesmo motivo
e passa a vir de `meta_apps.app_id`. Falha branda — só afeta template com
header de imagem.

## Mudanças de código

### Entrada — nada a fazer

O webhook já roteia por `phone_number_id` e não depende do
`UNIQUE(account_id)`. Dropar a constraint não quebra a entrada.

### Saída — ~13 call sites

Todos carregam `whatsapp_config` assumindo unicidade, a maioria com
`.single()` (que **erra** com ≥2 linhas — mesma armadilha da issue #363).
Cada um passa de *"a config da conta"* para *"a config desta conversa /
deste broadcast"*:

- `src/lib/whatsapp/send-message.ts:252`
- `src/lib/whatsapp/broadcast-core.ts:115`
- `src/lib/whatsapp/resolve-conversation.ts:59`
- `src/app/api/whatsapp/react/route.ts:113`
- `src/app/api/whatsapp/media/[mediaId]/route.ts:53`
- `src/app/api/whatsapp/templates/{submit,sync,[id]}/route.ts`
- `src/app/api/v1/contacts.ts:77`
- `src/lib/flows/meta-send.ts`, `src/lib/automations/meta-send.ts`
- `src/app/api/whatsapp/config/verify-registration/route.ts:59`

Mudar a assinatura para exigir a config/número e deixar o TypeScript
apontar os call sites restantes.

`templates/sync` passa a sincronizar **por WABA**, não uma vez por conta.

### UI — 3 áreas mudam de estrutura

| Tela | Mudança |
|---|---|
| Settings → WhatsApp | de **um formulário** para **lista de números** + cadastro de Meta Apps |
| Broadcast (wizard) | novo **passo 1: escolher número**; template vira passo 2 e passa a ser filtrado por WABA |
| Nova conversa (saída fria) | novo seletor de número — o único do produto |
| Inbox | indicar por qual número a conversa entrou. **Sem seletor** (decisão #3) |

O wizard de broadcast hoje é `step1-choose-template` → `step2-select-audience`
→ `step3-personalize` → `step4-schedule-send`. Como o template agora depende
da WABA, **não é possível listar templates antes de saber o número**: os
quatro componentes mudam de posição e de premissa.

## Fora de escopo

- **Design system.** Vem **depois** desta spec. Estas telas mudam de
  arquitetura de informação; estilizá-las antes é refazer o trabalho.
- **Usuário em várias contas / seletor de contas.** Desnecessário: um
  deployment por cliente. (A RLS já suportaria — `is_account_member` é um
  `EXISTS` sobre N linhas — mas `profiles.UNIQUE(user_id)` bloqueia. Não
  mexer.)
- **Auditoria de acesso** (LGPD/saúde) — gap conhecido, spec própria.
- **Cobrança / super-admin / revenda** — não existe; produto novo.

## Riscos

**Superfície de conflito com o upstream.** Esta spec toca exatamente a área
mais quente do upstream:

- `webhook-signature.ts` e o webhook (arquivo que eles mais mexem);
- o schema de `whatsapp_config`;
- **o índice da migration 036** — mergeada em 10/07/2026, a mudança mais
  recente do upstream. Ela existe para corrigir conversas duplicadas
  (issue #363) e cria `UNIQUE (account_id, contact_id)`. **A correção do bug
  deles é o nosso bloqueio**: sem alterá-la, mensagens de dois números
  colapsam silenciosamente na mesma thread.

São divergências deliberadas. Registrar aqui para que cada
`git merge upstream/main` futuro saiba onde esperar conflito.

**Colisão silenciosa.** Três dos pontos afetados são índices de unicidade
(036, `flow_runs`, dedup de contatos da 022). Índices são onde os axiomas
ficam guardados — e todos foram escritos quando "um número por conta" era
verdade. Errar aqui não gera exceção: gera dado errado.

## Em aberto

- Saída fria: quando o agente cria conversa nova em Vendas para um contato
  que já tem thread em Suporte, a UI deve mostrar as threads existentes?
  (decisão #2 diz que são desacopladas — mas o agente pode não saber que a
  outra existe).
- Ponto de referência do upstream no momento desta spec: `b867760`
  (10/07/2026). Anotar o SHA a cada merge incorporado.
