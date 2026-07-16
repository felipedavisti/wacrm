# Fase 0 — Pesquisa & Decisões

Feature: Conversas na ficha do contato (`004-conversas-na-ficha`).

## Decisão 1 — Reusar os helpers da inbox

**Decisão**: consultar via `CONVERSATION_SELECT` + `normalizeConversation` de
`@/lib/inbox/conversations`, filtrando por `contact_id` (e conta). Ordenar por
`last_message_at` desc.

**Justificativa**: consistência com a inbox (mesma forma de dados) e reuso;
evita divergência de shape.

## Decisão 2 — Deep link para a inbox

**Decisão**: cada conversa linka para `/inbox?c=<conversationId>` — o mesmo deep
link que o dashboard e a inbox já usam (`inbox/page.tsx:33`).

**Justificativa**: reusa o mecanismo existente; nada novo de rota.

## Decisão 3 — Estado vazio

**Decisão**: contato sem conversa mostra um estado vazio claro ("Nenhuma
conversa ainda"), sem erro. (Futuro: pode oferecer "iniciar conversa" — fora de
escopo aqui, encosta na saída fria do multi-número.)

## Decisão 4 — Forward-compat multi-número

**Decisão**: renderizar como **lista** desde já. Quando `conversations` ganhar
`whatsapp_config_id` (multi-número), cada item identifica o número. Hoje
tipicamente 1 item (índice único 036) — a lista lida com isso naturalmente.

**Justificativa**: escrever para N agora evita retrabalho quando a multi-número
chegar; custo zero hoje.

## Fora de escopo

- Iniciar conversa a partir da ficha (saída fria) — é do multi-número.
- Paginação avançada (a menos que o volume exija; ordenar+limitar basta por ora).
