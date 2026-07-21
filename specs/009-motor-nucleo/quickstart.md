# Quickstart — Motor de Leads Núcleo

Requer a **008-multi-conta** aplicada (empresa = account) e as extensões
`pg_cron`/`pg_net` habilitadas no projeto dev.

## Aplicar migrations

```powershell
supabase db push   # faixa 512_+ (008 foi até 511)
```

## Configurar

1. Provisionar 1 empresa (via 008) e um pipeline "Entrada" com um estágio inicial.
2. Cadastrar uma regra em `routing_map`: `campaign_match` → empresa (+ funil/estágio).
3. (Opcional) `account_destination_config` = `internal` (padrão) para a empresa.

## Cenário 1 — Lead do site vira deal no funil (US2)

```powershell
# token válido → 202; dedup 24h
curl -X POST .../api/leads/ingest/site -H "X-Site-Token: <token>" `
  -d '{ "nome":"Fulano","telefone":"71999...","email":"f@x.com","produto":"Plano A","campanha":"..." }'
```
- Verificar: 1 `lead_ingestions`; após o tick do worker, 1 `contact` + 1 `deal` no
  funil da empresa; reenviar o mesmo em 24h → `suppressed` (sem duplicar).

## Cenário 2 — Lead de Meta Form com rastreamento (US1)

- Enviar um leadgen de teste (assinatura válida) → verificar os 7 campos de
  rastreamento no `canonical` e espelhados no `deal.tracking`; reentregar o mesmo
  `meta_lead_id` → não duplica (FR-018).

## Cenário 3 — Falha e reprocessamento (US3)

- Forçar falha na entrega (ex.: destino externo stub offline) → lead fica `failed`
  após 5 tentativas; no painel, filtrar "Somente falhas", ver motivo, "Selecionar
  todas as N" e reenviar em lote → todos `sent`.

## Cenário 4 — Campanha sem de-para (US4)

- Enviar lead de campanha sem regra → `routing_status='pending'`, aparece na **fila
  central de não-roteados**, não no painel da empresa; cadastrar a regra → reprocessa
  e roteia; some da fila.

## Cenário 5 — Destino configurável (US5)

- Trocar `account_destination_config` para `external` (stub) → próximos leads são
  entregues ao destino externo pelo mesmo outbox; núcleo inalterado.

## Testes esperados

- Ingestão fail-closed (token/assinatura inválidos → rejeitado + registrado).
- Idempotência Meta; dedup Site 24h; suprimidos rastreáveis.
- Worker: SKIP LOCKED, backoff, 5 tentativas, sem reenvio duplo simultâneo.
- Isolamento: entrega carimba o account certo; painel não vaza entre empresas (reusa
  suíte de tenancy da 008).
