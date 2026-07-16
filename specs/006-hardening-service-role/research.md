# Fase 0 — Pesquisa & Decisões

Feature: Endurecimento service_role (`006-hardening-service-role`).

## Decisão 1 — Testes de isolamento por caminho

**Decisão**: para cada caminho, um teste que simula uma operação da conta A
tentando alcançar um id da conta B, e afirma que **não vaza** (falha "não
encontrado para a conta" ou no-op). Usar mocks de client/DB que reproduzem o
filtro `account_id`.

**Justificativa**: transforma o isolamento de promessa em garantia executável
(SC-002). O teste falha se alguém remover o `.eq('account_id', ...)`.

## Decisão 2 — Guarda explícita de escopo

**Decisão**: onde o escopo for implícito, introduzir um helper (ex.:
`requireAccountScope`) que recebe `account_id` e recusa quando ausente/nulo,
tornando o esquecimento um erro em vez de um vazamento silencioso.

**Justificativa**: o padrão já existe nos meta-send; um helper o torna
universal e evidente na revisão (FR-004, FR-006).

## Decisão 3 — Invariante documentado para o webhook

**Decisão**: o webhook não filtra por `account_id` de entrada — ele **resolve** a
conta a partir do `phone_number_id` (único, constraint 013). Isso é um invariante
**seguro** e DEVE ser documentado como tal no inventário (não é uma exceção
frágil, é o mapeamento número→conta).

## Decisão 4 — Inventário no repo

**Decisão**: um `docs/service-role-inventory.md` lista cada caminho, o que ele
toca, e o invariante que o isola (filtro `account_id` ou `phone_number_id`
único). Revisões de mudança consultam/atualizam esse doc.

## Fora de escopo

- Reescrever os caminhos para não usar service_role (arquitetura maior).
- Auditoria de acesso (leitura) — spec futura.
- Os caminhos RLS (cobertos por `is_account_member`) — o foco é o que **ignora** RLS.
