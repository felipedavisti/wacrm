# Fase 0 — Pesquisa & Decisões de Design

Feature: Atribuição de autor da mensagem (`003-auditoria-acesso`).

## Levantamento (análise de pontas soltas)

- `messages.sender_id UUID` existe (migration 001) e está no tipo TS, mas
  **nenhum insert o preenche** (grep confirmou: só aparece em tipo/comentário).
- Único insert de agente: `send-message.ts:455` (`sender_type='agent'`, sem
  `sender_id`). A rota `/api/whatsapp/send` já tem `auth.getUser` (o agente).
- Inserts de bot (flows ×3, automations ×1) e de customer (webhook) — corretos
  com `sender_id` nulo.
- Broadcast **não** insere em `messages`.
- API pública: `ApiMessage` já **omite** `sender_id` (não vaza).
- UI: `message-thread.tsx` cria 4 objetos **otimistas** (`sender_type='agent'`)
  antes da confirmação do servidor.

## Decisão 1 — `senderId` como parâmetro do core

**Decisão**: adicionar `senderId?: string | null` a `SendMessageParams` em
`send-message.ts`; o insert grava `sender_id: senderId ?? null`. A rota
autenticada passa `user.id`; a API pública passa `null`.

**Justificativa**: o core é compartilhado entre dashboard (com agente) e API
pública (sem agente humano). Um param opcional cobre os dois sem ramificar o
core. Consistente com o padrão de "quem chama sabe o autor".

**Alternativa**: ler `auth.uid()` dentro do core — rejeitada: o core recebe um
client que pode ser service-role (API), onde `auth.uid()` não existe.

## Decisão 2 — Bot/customer/API ficam nulos

**Decisão**: não atribuir autor a envios de bot (o `sender_type='bot'` já
distingue), a mensagens de cliente, nem a envios via API pública (sem humano).
Opção futura de atribuir envios de API ao **dono da chave** fica registrada, fora
de escopo.

**Justificativa**: o pedido do PO é "quem **mandou** a mensagem" no sentido de
agente humano. Bot já é identificável; atribuir bot a um humano seria enganoso.

## Decisão 3 — Exibição e resolução de nome

**Decisão**: na inbox, resolver `sender_id` para o nome do agente usando os
**membros da conta já carregados** (evita query extra por mensagem). Exibir
"enviado por \<nome\>" nas mensagens de saída de agente. Rótulo entra no
dicionário de i18n (feature 002). Degradar para "autor desconhecido"/sem autor
quando `sender_id` for nulo ou apontar para ex-membro.

**Justificativa**: reaproveita dados já em memória; robusto a membros removidos;
respeita a localização.

## Decisão 4 — Otimista reflete autor

**Decisão**: os objetos otimistas em `message-thread.tsx` passam a incluir
`sender_id` = id do agente atual, para a exibição não "piscar" ao confirmar.

## Fora de escopo (registrado)

- Auditoria de **leitura** (LGPD "quem leu") — spec futura.
- Backfill de mensagens antigas (autor retroativo é desconhecido).
- Atribuir envios de API ao dono da chave.
