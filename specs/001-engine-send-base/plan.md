# Plano de Implementação: Engine Send Base compartilhada

**Branch**: `001-engine-send-base` | **Data**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

## Resumo

Extrair a sequência de envio duplicada entre os dois motores (`automations` e
`flows`) para um módulo compartilhado `src/lib/whatsapp/engine-send-base.ts`,
mantendo os **dois** paradigmas. A resolução do `whatsapp_config` vira uma
**costura** (`resolveConfig`) isolada em um único ponto — hoje resolve por
`account_id` com `.single()`; no futuro (multi-número) resolverá por conversa,
sem tocar nos motores. Comportamento observável idêntico; sem migrations; sem
mudança de UI.

## Contexto Técnico

**Linguagem/Versão**: TypeScript 6, Next.js 16 (App Router), React 19
**Dependências primárias**: `@supabase/supabase-js` (client service-role via
`admin-client.ts`), primitivas Meta em `src/lib/whatsapp/meta-api.ts`
**Armazenamento**: Postgres (Supabase). Tabelas tocadas em runtime: `contacts`,
`whatsapp_config`, `messages`, `conversations`. **Sem alteração de schema.**
**Testes**: Vitest (`*.test.ts`). Manter verdes: `meta-api.*.test`,
`send-message.test`, testes dos engines. Adicionar: `engine-send-base.test`.
**Plataforma-alvo**: servidor Node (rotas/server actions) + webhook
**Tipo de projeto**: web app (Next.js) — refactor interno da camada de envio
**Restrições**: comportamento idêntico; filtro `account_id` preservado
(defesa em profundidade sobre service-role); costura `resolveConfig` isolada
**Escala/escopo**: 4 funções de envio duplicadas → 1 base + 2 adaptadores finos

## Constitution Check

*GATE: precisa passar antes da Fase 0. Reavaliar após a Fase 1.*

| Princípio | Avaliação |
|---|---|
| **II — Segurança é a camada de autorização** | ✅ O filtro `account_id` nas queries de contato e config é **preservado** dentro da base (defesa em profundidade sobre o client service-role que ignora RLS). Nada de `service_role` vaza para client. Sem novo caminho de bypass. |
| **IV — Mudança dirigida por spec** | ✅ Refactor com spec própria; **prepara** a costura de multi-número sem implementá-la (fora de escopo explícito). |
| **V — Disciplina de upstream** | ✅ Aditivo: novo módulo `engine-send-base.ts` + reescrita dos dois `meta-send.ts` como adaptadores. Baixa superfície de conflito. Sem migration (sem colisão de faixa `500_`). |
| **VII — Manutenibilidade** | ✅ De 4 cópias para 1. Menos chance de divergência entre motores. |
| **I — LGPD / dados sensíveis** | ➖ Sem impacto: não muda tratamento, residência ou operadores de dados. |
| **III — Só API oficial** | ➖ Sem impacto: continua usando as primitivas Meta oficiais. |

**Resultado**: PASSA. Nenhuma violação. Nenhuma justificativa de complexidade
necessária. (Reavaliação pós-Fase 1: sem mudança — o design mantém todos os
invariantes.)

## Estrutura do Projeto

### Documentação (esta feature)

```text
specs/001-engine-send-base/
├── spec.md              # a especificação
├── plan.md              # este arquivo
├── research.md          # Fase 0 — decisões de design
├── data-model.md        # Fase 1 — entidades internas (não-DB)
├── contracts/
│   └── engine-send-base.md   # o contrato de sendFromEngine (coração)
├── quickstart.md        # Fase 1 — como verificar o refactor
└── tasks.md             # Fase 2 — gerado por /speckit-tasks
```

### Código-fonte (raiz do repositório)

```text
src/lib/whatsapp/
├── engine-send-base.ts        # NOVO — a base compartilhada (sendFromEngine)
├── engine-send-base.test.ts   # NOVO — testes da base
├── meta-api.ts                # inalterado (primitivas Meta cruas)
├── send-message.ts            # inalterado (core do envio manual do usuário)
├── phone-utils.ts             # inalterado (phoneVariants, isValidE164, ...)
└── encryption.ts              # inalterado (decrypt)

src/lib/automations/
├── meta-send.ts               # REESCRITO — adaptador fino sobre a base
└── engine.ts                  # inalterado (chama engineSendText/Template/Interactive)

src/lib/flows/
├── meta-send.ts               # REESCRITO — adaptador fino sobre a base
└── engine.ts                  # inalterado (chama engineSendText/Media/Interactive*)
```

**Decisão de estrutura**: a base vive em `src/lib/whatsapp/` (junto do restante
da camada Meta), não dentro de um motor, porque é compartilhada pelos dois. Os
`meta-send.ts` de cada motor permanecem como o ponto de entrada de cada motor
(assinaturas públicas inalteradas para `engine.ts`), agora delegando à base.

## Complexity Tracking

> Nenhuma violação de Constitution Check. Seção sem itens.

## Fluxo de execução (fases)

- **Fase 0 (research.md)**: fixar a forma da costura `resolveConfig`, da
  parametrização (`doMetaSend`, `buildMessageRow`), e a estratégia de teste sem
  regressão.
- **Fase 1 (contracts + data-model + quickstart)**: contrato de `sendFromEngine`,
  entidades internas, e roteiro de verificação. Atualizar o ponteiro do plano em
  `CLAUDE.md`.
- **Fase 2 (/speckit-tasks)**: decompor em tarefas ordenadas por dependência.
