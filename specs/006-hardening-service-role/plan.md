# Plano de Implementação: Endurecimento dos caminhos service_role

**Branch**: `006-hardening-service-role` | **Data**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

## Resumo

Enumerar os caminhos que usam o client `service_role` (ignoram RLS), confirmar/
tornar explícito o filtro por `account_id` em cada query, adicionar **testes de
isolamento** por caminho, e uma guarda + inventário que impede regressão. Sem
mudança funcional.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6, Vitest, Supabase (service_role client)
**Superfície service_role** (a mapear em detalhe no inventário):
- Admin-clients: `src/lib/{flows,automations,ai}/admin-client.ts` (fábricas idênticas)
- Webhook: `src/app/api/whatsapp/webhook/route.ts` (roteia por `phone_number_id`)
- Config: `src/app/api/whatsapp/config/route.ts`
- API keys: `src/lib/api-keys/store.ts`
- Helpers de envio: `send-message.ts`, `{flows,automations}/meta-send.ts`,
  `resolve-conversation.ts`, `ai/auto-reply.ts`
- Crons: `api/automations/cron`, `api/flows/cron`
**Invariantes de tenancy**: `account_id` (migration 017); webhook por
`phone_number_id` único (013).

## Constitution Check

| Princípio | Avaliação |
|---|---|
| **II — Segurança é a camada de autorização** | ✅ É a implementação direta: a superfície de auditoria vira enumerada, guardada e testada. |
| **V — Disciplina de upstream** | ✅ Aditivo: testes + guarda + doc de inventário; poucas mudanças de código. |
| **VII — Manutenibilidade** | ✅ A convenção impede a superfície crescer sem isolamento. |
| **I** | ✅ Reforça o isolamento de dados sensíveis por conta. |
| **III/IV** | ➖ Sem impacto. |

**Resultado**: PASSA.

## Estrutura do Projeto

```text
docs/
└── service-role-inventory.md            # NOVO — inventário dos caminhos + invariante de cada

src/lib/auth/ (ou similar)
└── account-scope.ts (opcional)          # guarda: exige account_id, recusa se ausente

src/lib/**/*.test.ts                      # NOVOS testes de isolamento por caminho
```

## Complexity Tracking

> Sem violação.

## Fases

- **Fase 0 (research)**: forma da guarda; estratégia de teste de isolamento
  (mock de DB por conta); o que conta como "invariante documentado" (webhook).
- **Fase 1 (quickstart + inventário)**: roteiro de verificação + esqueleto do doc.
- **Fase 2 (/speckit-tasks)**: tarefas por caminho.
