# Plano de Implementação: Janela de 24h proativa

**Branch**: `005-janela-24h` | **Data**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

## Resumo

Rastrear a última mensagem de entrada por conversa (`conversations.last_inbound_at`,
migration `500_`), derivar o estado da janela de 24h, recusar envios de texto
livre fora da janela com erro claro **antes** da Meta (com mapeamento do 131047
como backstop), e avisar proativamente no composer da inbox oferecendo template.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6, Next.js 16, Postgres (Supabase)
**Rastreio**: nova coluna `conversations.last_inbound_at TIMESTAMPTZ`
(migration `supabase/migrations/500_conversations_last_inbound_at.sql`),
atualizada pelo webhook em mensagens de cliente.
**Webhook**: `src/app/api/whatsapp/webhook/route.ts` (já grava a mensagem de
entrada — adicionar o update de `last_inbound_at`).
**Envio**: `src/lib/whatsapp/send-message.ts` (checar a janela para não-template)
+ `meta-api.ts`/erros (mapear 131047).
**UI**: `src/components/inbox/message-composer.tsx` + a thread (indicar janela).
**i18n**: mensagens novas em pt/en (feature 002).

## Constitution Check

| Princípio | Avaliação |
|---|---|
| **III — Só API oficial / janela 24h** | ✅ É a implementação direta do "tratar a janela graciosamente". |
| **V — Disciplina de upstream** | ✅ Migration na faixa **500_** (primeira do fork). Mudanças pontuais e aditivas no webhook/send/UI. |
| **II — Segurança** | ✅ Checagem no core account-scoped; sem novo bypass. |
| **VII — Manutenibilidade** | ✅ Coluna derivável barata (vs. varrer messages). |
| **I** | ➖ Sem impacto de dados sensíveis. |

**Resultado**: PASSA.

## Estrutura do Projeto

```text
supabase/migrations/
└── 500_conversations_last_inbound_at.sql   # NOVA coluna + (opcional) backfill

src/app/api/whatsapp/webhook/route.ts       # set last_inbound_at em msg de cliente
src/lib/whatsapp/
├── send-message.ts                         # checar janela p/ não-template → window_expired
├── meta-api.ts (ou tratamento de erro)     # mapear 131047 (backstop)
└── window.ts (novo, opcional)              # helper isWindowOpen(last_inbound_at)
src/components/inbox/
├── message-composer.tsx                    # avisar + oferecer template fora da janela
└── message-thread.tsx                      # (se necessário) indicar estado da janela
messages/{en,pt}.json                       # mensagens novas
```

## Complexity Tracking

> Sem violação.

## Fases

- **Fase 0 (research)**: decisão coluna vs. query; backfill; onde checar; forma do erro.
- **Fase 1 (data-model + quickstart)**: migration + verificação. Ponteiro CLAUDE.md.
- **Fase 2 (/speckit-tasks)**: tarefas.
