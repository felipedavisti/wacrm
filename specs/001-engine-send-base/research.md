# Fase 0 — Pesquisa & Decisões de Design

Feature: Engine Send Base compartilhada (`001-engine-send-base`).

Nenhum "NEEDS CLARIFICATION" crítico restou da spec. As decisões abaixo fixam a
forma do refactor com base na análise do fonte atual.

## Decisão 1 — Forma da costura de config: resolver injetado

**Decisão**: a base recebe uma função `resolveConfig(ctx) → { phoneNumberId,
accessToken }`, não a config crua nem o `.single()` embutido.

**Justificativa**: é o requisito FR-004 e o retorno estratégico da feature. Com
um resolver injetado, a multi-número troca **uma** implementação
(`resolveConfigByAccount` → `resolveConfigByConversation`) sem tocar na base nem
nos motores. A base fica agnóstica de "quantos números existem".

**Alternativas consideradas**:
- *Passar a config já resolvida como valor*: funcionaria, mas empurra a query
  para cada adaptador → volta a duplicar o `.single()` (o problema original).
- *Manter o `.single()` na base*: mais simples hoje, mas quebra o FR-004 — a
  multi-número teria de reescrever a base. Rejeitado.

## Decisão 2 — Parametrização por tipo: `doMetaSend` + `buildMessageRow`

**Decisão**: a base recebe (a) `doMetaSend({ to, phoneNumberId, accessToken })`
para a chamada Meta específica, e (b) `buildMessageRow() → { row, preview }`
para os campos por tipo da linha `messages` e o texto de preview da conversa.

**Justificativa**: são exatamente os dois pontos que variam entre os 4 envios
atuais; todo o resto (contato, retry, persistência, update de conversa) é
idêntico. Isola a variação nos dois callbacks e deixa a base 100% comum.

**Alternativas consideradas**:
- *Um enum `kind` + switch dentro da base*: concentraria o conhecimento de todos
  os tipos na base (acoplamento), e cada tipo novo mexeria na base. Os callbacks
  mantêm a base fechada para modificação. Rejeitado.

## Decisão 3 — Assinaturas públicas dos motores permanecem

**Decisão**: `engineSendText`, `engineSendTemplate`, `engineSendMedia`,
`engineSendInteractiveButtons/List`, `engineSendInteractive` mantêm suas
assinaturas atuais; só o corpo passa a delegar a `sendFromEngine`.

**Justificativa**: `automations/engine.ts` e `flows/engine.ts` não mudam →
menor superfície de regressão e de conflito com o upstream (Princípio V).

## Decisão 4 — Interativos compartilhados absorvidos pela base

**Decisão**: os senders interativos (hoje só em `flows/meta-send.ts`, já
importados pelo `automations/meta-send.ts`) passam a usar a mesma base. O
`automations/meta-send.ts` deixa de importar do `flows` e passa a importar a
base.

**Justificativa**: remove o acoplamento cruzado atual (automations → flows) e o
substitui por ambos → base. Direção mais limpa e simétrica.

## Decisão 5 — Estratégia de não-regressão

**Decisão**: caracterizar o comportamento atual com testes **antes** de mexer
(characterization tests) onde ainda não existirem, depois refatorar mantendo-os
verdes. A base ganha testes cobrindo: retry por variante de telefone; filtro
`account_id` (não envia para contato de outra conta); falha de INSERT pós-envio
(erro específico, Meta já recebeu); e os campos por tipo de mensagem.

**Justificativa**: SC-001/SC-004 exigem comportamento idêntico verificável. Os
testes são a rede que garante "nenhuma regressão" (US1, P1).

**Alternativas consideradas**:
- *Refatorar e testar depois*: arrisca regressão silenciosa nos dois paradigmas.
  Rejeitado — contradiz o objetivo de segurança da feature.

## Não-decisões (fora de escopo, registradas)

- Convergir `send-message.ts` (envio manual do usuário) com a base: desejável,
  mas maior risco; fica para um refactor futuro.
- Resolver por conversa (multi-número): a base fica pronta, mas a implementação
  é da spec de multi-número.
- Consolidar `templates.ts` / `validate.ts`: são paradigma-específicos.
