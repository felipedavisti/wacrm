# Contratos — Operação e reprocessamento (interface visual)

Rotas autenticadas (SSR, RLS por empresa ativa). O painel operacional é **escopado
pela empresa ativa** (Q3). A superfície de roteamento é **central/admin**.

## Painel operacional (por empresa ativa)

### `GET /api/leads` — lista (FR-027)
- Filtros: `source`, `status`, `period` (combináveis). Escopo: account ativo (RLS).
- Resposta: página de leads (id, contato, origem, status, campanha, criado_em,
  deal_id) + totalizadores do filtro. Paginação.

### `GET /api/leads/:id` — detalhe (FR-029)
- Retorna o canônico, o **payload bruto**, o histórico de tentativas (com erro por
  tentativa) e os eventos suprimidos por dedup vinculados.

### `POST /api/leads/reprocess` — reenvio (FR-028)
- Body: `{ ids: [uuid] }` **ou** `{ filter: {...}, all: true }` (selecionar todas as
  falhas do filtro, não só a página).
- Efeito: reagenda os `lead_delivery_jobs` das ingestões; **lock** impede reenvio
  duplicado simultâneo do mesmo lead (advisory lock / status `processing`).
- Resposta: `{ requeued: n }`; o painel reflete o resultado por lead (quase real).

### `GET /api/leads/metrics` — indicadores do dia (FR-030)
- Total do dia, volume por origem, falhas (qtd e %), no escopo do account ativo.
  Atualização por consulta periódica (≤ 30s, SC-006).

## Superfície central (admin/TI — roteamento)

### `routing_map` CRUD (FR-011/012/015)
- Listar/criar/editar/desativar regras campanha/origem → empresa (+ funil/estágio).
- Acesso restrito a admin/TI (não por empresa ativa).

### Fila de não-roteados
- `GET` leads com `routing_status='pending'` (sem empresa) — os de campanha sem
  de-para (FR-007/SC-007). Ao cadastrar a regra, reprocessa e roteia.

## Config de destino por conta (FR-036)

### `GET/PUT /api/account/lead-destination`
- Ler/gravar `account_destination_config` da empresa ativa (interno|externo + config).
  Admin da conta. Sem config ⇒ interno.
