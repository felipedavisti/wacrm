# Tarefas: Engine Send Base compartilhada

**Feature**: `001-engine-send-base` | **Spec**: [spec.md](./spec.md) | **Plano**: [plan.md](./plan.md)

Abordagem **test-first (characterization)**: fixamos o comportamento atual com
testes antes de mover código, depois refatoramos mantendo tudo verde. Isso é o
que garante a US1 (nenhuma regressão).

**Invariantes globais** (critério de aceite em toda tarefa que toca envio):
comportamento observável idêntico · filtro `account_id` preservado ·
`sender_type='bot'`/`status='sent'`/`interactive_payload`/`ai_generated`
preservados · sem migration · sem mudança de UI · assinaturas públicas dos
motores inalteradas · **`userId` ignorado pela base (FR-011)** · **mensagens de
erro verbatim (FR-012)** para não alterar os logs dos motores.

**Fora de escopo**: multi-número, `templates.ts`/`validate.ts`, `send-message.ts`.

**Legenda**: `[P]` = paralelizável (arquivos diferentes, sem dependência pendente).

---

## Fase 1 — Setup

- [ ] T001 Confirmar baseline verde antes de qualquer mudança: rodar `npm run test` e `npm run typecheck` e registrar que passam. Se algo já estiver vermelho, resolver/registrar antes de seguir.

---

## Fase 2 — Fundacional (bloqueia as user stories)

Sem tarefas de infraestrutura nova (sem schema, sem deps). O trabalho fundacional
é a rede de testes de caracterização, que pertence à US1 (é o que a protege) —
portanto está na Fase 3.

---

## Fase 3 — US1: Nenhuma regressão nos dois motores (P1) 🎯 MVP

**Meta**: caracterizar o comportamento atual dos 4 envios com testes, criar a
base compartilhada, e migrar os dois motores para ela **sem** mudar comportamento.

**Teste independente**: disparar flow (texto/mídia/botões/lista/coleta/handoff) e
automação (texto/template/botões/lista) antes e depois → mensagem entregue, linha
em `messages` e update de conversa idênticos.

### Caracterização (fixar o "antes")

- [ ] T002 [P] [US1] Testes de caracterização de `src/lib/flows/meta-send.ts` em `src/lib/flows/meta-send.test.ts`: cobrir `engineSendText`, `engineSendMedia`, `engineSendInteractiveButtons`, `engineSendInteractiveList` — retry por variante de telefone, filtro `account_id` (contato de outra conta → erro), falha de INSERT pós-envio, e os campos por tipo em `messages` (incl. `interactive_payload`, `ai_generated`).
- [ ] T003 [P] [US1] Testes de caracterização de `src/lib/automations/meta-send.ts` em `src/lib/automations/meta-send.test.ts`: cobrir `engineSendText`, `engineSendTemplate`, `engineSendInteractive` — mesmos eixos (retry, `account_id`, insert pós-envio, campos por tipo, preview `[template:...]`).
- [ ] T004 [US1] Rodar `npm run test` e confirmar T002+T003 verdes contra o código ATUAL (a rede de segurança existe antes de mover qualquer coisa).

### Criar a base compartilhada

- [ ] T005 [US1] Criar `src/lib/whatsapp/engine-send-base.ts` conforme [contracts/engine-send-base.md](./contracts/engine-send-base.md): tipos `ResolvedSendConfig`, `ResolveConfig`, `DoMetaSend`, `EngineMessageRow`, `SendFromEngineArgs`; função `sendFromEngine` com o comportamento invariante (contato por `(id, account_id)` → E.164 → `resolveConfig` → retry por `phoneVariants`/`isRecipientNotAllowedError` → correção de telefone → insert em `messages` com `sender_type='bot'`/`status='sent'`/`message_id` → update de conversa). O filtro `account_id` fica DENTRO da base.
- [ ] T006 [US1] Implementar `resolveConfigByAccount` (a costura de hoje) em `src/lib/whatsapp/engine-send-base.ts`: carrega `whatsapp_config` por `account_id` com `.single()` e faz `decrypt(access_token)`, devolvendo `{ phoneNumberId, accessToken }`. É o ÚNICO ponto com o `.single()` — a multi-número troca só isto depois.
- [ ] T007 [P] [US1] Testes de `src/lib/whatsapp/engine-send-base.test.ts`: retry (2ª variante funciona + telefone corrigido no contato), filtro `account_id` (contato de outra conta → erro, sem envio), falha de INSERT pós-envio → erro "sent to Meta but DB insert failed", e cada `buildMessageRow`/`preview` por tipo. Usar mocks de `db` e de `doMetaSend`.

### Migrar os motores para a base

- [ ] T008 [US1] Reescrever `src/lib/flows/meta-send.ts` como adaptador fino sobre `sendFromEngine`: `engineSendText`, `engineSendMedia`, `engineSendInteractiveButtons`, `engineSendInteractiveList` mantêm **as mesmas assinaturas públicas**, mas o corpo monta `{ doMetaSend, buildMessageRow, resolveConfig: resolveConfigByAccount }` e delega. Remover a lógica duplicada (contato/config/retry/persistência). Preservar `ai_generated` no texto e `interactive_payload` nos interativos.
- [ ] T009 [US1] Rodar `npm run test` — T002 (caracterização de flows) deve continuar verde com o novo corpo. Ajustar até idêntico.
- [ ] T010 [US1] Reescrever `src/lib/automations/meta-send.ts` como adaptador fino: `engineSendText`, `engineSendTemplate`, `engineSendInteractive` delegam a `sendFromEngine`. **Remover o import de `@/lib/flows/meta-send`** — os interativos passam a vir da base compartilhada (fim do acoplamento automations→flows). Preservar o preview `[template:...]`.
- [ ] T011 [US1] Rodar `npm run test` — T003 (caracterização de automations) deve continuar verde. Ajustar até idêntico.

**Checkpoint US1**: os dois motores enviam pela base; caracterização verde; nenhuma cópia duplicada da sequência de envio.

---

## Fase 4 — US2: Resolução de número em um único ponto (P1)

**Meta**: garantir, por construção e teste, que a resolução de config é uma
costura única, pronta para a multi-número.

**Teste independente**: `grep` não acha `.single()` de `whatsapp_config` fora de
`engine-send-base.ts`; trocar `resolveConfigByAccount` tocaria 1 arquivo.

- [ ] T012 [US2] Verificar que nenhum `.from('whatsapp_config').…single()` de envio permanece em `src/lib/flows/meta-send.ts` nem em `src/lib/automations/meta-send.ts` (só em `engine-send-base.ts` via `resolveConfigByAccount`). Registrar no PR.
- [ ] T013 [P] [US2] Teste em `src/lib/whatsapp/engine-send-base.test.ts` que injeta um `resolveConfig` alternativo (fake por conversa) e prova que `sendFromEngine` o usa sem nenhuma outra mudança — demonstrando a prontidão para multi-número (sem implementá-la).

---

## Fase 5 — US3: Um único ponto de envio dos motores (P2)

**Meta**: confirmar a remoção da duplicação e a saúde geral.

- [ ] T014 [US3] Revisão de código: a sequência de envio (contato→config→retry→persistência→update de conversa) aparece só em `engine-send-base.ts`. Os dois `meta-send.ts` são adaptadores finos. Registrar diff de linhas removidas.
- [ ] T015 [US3] Confirmar que `src/lib/automations/engine.ts` e `src/lib/flows/engine.ts` **não foram alterados** (assinaturas públicas preservadas).

---

## Fase 6 — Polimento & Verificação Cruzada

- [ ] T016 Rodar `npm run test` (suíte completa) e `npm run typecheck` — tudo verde/limpo (quickstart §1).
- [ ] T017 [P] Verificar precedência do webhook intacta: com um flow que consome a mensagem, a automação de conteúdo e o auto-reply de IA não disparam (flows > automations > IA). Cobrir por teste do webhook OU verificação manual registrada (quickstart §2.3).
- [ ] T018 [P] Verificar `ai_generated=true` preservado no caminho do auto-reply de IA (quickstart §2.4).
- [ ] T019 Passar o `code-review` na diff da branch focado em: filtro `account_id`, paridade de comportamento, e ausência de novo caminho que fure a RLS (Constitution, Princípio II).

---

## Dependências & Ordem

- **T001** (baseline) antes de tudo.
- **US1 é o MVP**: T002→T003→**T004** (rede verde) → T005/T006 (base) → **T007** → T008→**T009** → T010→**T011**. Os `[P]` (T002, T003, T007) rodam em paralelo por serem arquivos diferentes.
- **US2** (T012–T013) depois de T008/T010 (precisa dos adaptadores prontos).
- **US3** (T014–T015) depois da US1.
- **Fase 6** por último.

## Estratégia de entrega

- **MVP = US1** (T001–T011): base criada, dois motores migrados, comportamento
  idêntico provado. Já entrega o valor central e é implantável sozinho.
- **US2** formaliza/prova a costura (o retorno estratégico para multi-número).
- **US3 + Polimento** fecham a limpeza e a verificação cruzada.

## Oportunidades de paralelismo

- T002 ∥ T003 (caracterização dos dois motores, arquivos distintos).
- T007 pode ser escrito em paralelo à implementação de T005/T006.
- T017 ∥ T018 (verificações independentes no polimento).
