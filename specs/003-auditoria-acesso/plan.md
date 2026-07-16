# Plano de Implementação: Atribuição de autor da mensagem (sender_id)

**Branch**: `003-auditoria-acesso` | **Data**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

## Resumo

Preencher `messages.sender_id` (coluna já existente) com o id do agente
autenticado nos envios manuais, exibir o autor na inbox, e preservar a omissão
de `sender_id` na API pública. Sem migration; mudança pontual nos caminhos de
envio e na exibição.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6, Next.js 16, React 19
**Armazenamento**: Postgres (Supabase). Coluna `messages.sender_id UUID` **já
existe** (migration 001); tipo em `types/index.ts:225`. **Sem migration.**
**Caminho de envio**: `src/lib/whatsapp/send-message.ts` (core compartilhado);
rota `src/app/api/whatsapp/send/route.ts` (tem `auth.getUser`); API pública
`src/app/api/v1/messages`.
**Exibição**: `src/components/inbox/message-thread.tsx` (thread + otimista);
resolução de nome via membros da conta.
**API pública**: serializer `ApiMessage` em `src/lib/api/v1/conversations.ts`
(já omite `sender_id` — preservar).
**Testes**: Vitest. `send-message.test.ts` cobre o core.

**Mapa de inserts em `messages`** (análise de pontas soltas):

| Caminho | sender_type | Ação em sender_id |
|---|---|---|
| `webhook/route.ts:671` | customer | nulo (correto, sem mudança) |
| `send-message.ts:455` (agente) | agent | **preencher com o agente** ← foco |
| `flows/meta-send.ts` (×3) | bot | nulo (sem mudança) |
| `automations/meta-send.ts:200` | bot | nulo (sem mudança) |
| `broadcast-core.ts` | — | não insere em `messages` (N/A) |
| `message-thread.tsx` (×4) | agent | objeto **otimista** (client) — setar autor p/ exibição |

## Constitution Check

| Princípio | Avaliação |
|---|---|
| **I — LGPD / dados sensíveis** | ✅ Adiciona atribuição de autoria (accountability de saída). **Não** substitui a auditoria de leitura, explicitamente fora de escopo. |
| **II — Segurança** | ✅ `sender_id` é interno; a API pública continua omitindo-o (FR-005). O envio de agente usa o client RLS-scoped da rota autenticada. |
| **V — Disciplina de upstream** | ✅ Sem migration; mudança pontual e aditiva. Baixo conflito. |
| **VII — Manutenibilidade** | ✅ Popular um campo já modelado; nada de estrutura nova. |
| **III/IV** | ➖ Sem impacto. |

**Resultado**: PASSA.

## Estrutura do Projeto

```text
src/lib/whatsapp/
├── send-message.ts        # + param senderId; set sender_id no insert (FR-001..004)
└── send-message.test.ts   # + casos de sender_id (agente / nulo)

src/app/api/whatsapp/send/route.ts   # passar user.id (auth.getUser) como senderId
src/app/api/v1/messages/…            # senderId = null (sem agente humano)
src/lib/api/v1/conversations.ts      # inalterado — ApiMessage já omite sender_id (guardar)

src/components/inbox/
├── message-thread.tsx     # exibir "enviado por <agente>"; otimista reflete autor
└── (resolução sender_id → nome via membros da conta já carregados)
```

**Sem** `messages/` de i18n novos além dos rótulos ("enviado por…") que entram
no dicionário (respeitando a feature 002 de localização).

## Complexity Tracking

> Sem violação.

## Fases

- **Fase 0 (research.md)**: fixar a forma do param `senderId` no core, o
  tratamento por caminho (agente/bot/customer/API), e a estratégia de exibição/
  resolução de nome.
- **Fase 1 (contracts + data-model + quickstart)**: contrato do param, entidades,
  verificação. Atualizar ponteiro em `CLAUDE.md`.
- **Fase 2 (/speckit-tasks)**: tarefas ordenadas.
