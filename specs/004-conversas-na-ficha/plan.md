# Plano de Implementação: Conversas na ficha do contato

**Branch**: `004-conversas-na-ficha` | **Data**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

## Resumo

Adicionar uma seção "Conversas" na ficha do contato (`contact-detail-view.tsx`)
que lista as conversas do contato (por `contact_id`, account-scoped), com status
e última atividade, cada uma linkando para `/inbox?c=<id>`. Lista preparada para
N conversas (multi-número). Sem migration.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6, Next.js 16, React 19
**Componente**: `src/components/contacts/contact-detail-view.tsx` (client) —
já consulta contacts/tags/notes/custom_fields/deals; **falta** `conversations`.
**Query reuso**: `CONVERSATION_SELECT` / `normalizeConversation` de
`@/lib/inbox/conversations`.
**Deep link inbox**: `/inbox?c=<conversationId>` (`inbox/page.tsx:33`).
**Dados da conversa**: `conversations` — `status`, `last_message_text`,
`last_message_at`, `unread_count`, `contact_id`. **Sem migration.**
**i18n**: rótulos novos em `pt.json`/`en.json` (feature 002).

## Constitution Check

| Princípio | Avaliação |
|---|---|
| **II — Segurança** | ✅ Query account-scoped no client (RLS cobre); sem novo caminho service_role. |
| **V — Disciplina de upstream** | ✅ Aditivo: uma seção nova no componente + uma query. Sem migration. |
| **VII — Manutenibilidade** | ✅ Reusa os helpers da inbox; nada novo de infra. |
| **UX pt-BR** | ✅ Rótulos via i18n. |
| **I/III/IV** | ➖ Sem impacto. |

**Resultado**: PASSA.

## Estrutura do Projeto

```text
src/components/contacts/
└── contact-detail-view.tsx   # + query de conversations + seção "Conversas" com link /inbox?c=<id>

messages/{en,pt}.json          # + rótulos ("Conversas", "Sem conversas", ...)
```

## Complexity Tracking

> Sem violação.

## Fases

- **Fase 0 (research)**: forma da query, ordenação, estado vazio, e como
  identificar o número (forward-compat multi-número).
- **Fase 1 (data-model + quickstart)**: entidades + verificação. Ponteiro no CLAUDE.md.
- **Fase 2 (/speckit-tasks)**: tarefas.
