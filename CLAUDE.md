@AGENTS.md

<!-- SPECKIT START -->
Feature ativa: `specs/009-motor-nucleo/` — Núcleo do Motor de Leads (ingestão
Site/Meta Form, roteamento por empresa, outbox/resiliência, reprocessamento).
Plano atual: `specs/009-motor-nucleo/plan.md`. Fundação já entregue:
`specs/008-multi-conta/` (multi-empresa). Constituição:
`.specify/memory/constitution.md`.

Nota de RLS (lição da 008/migration 512): toda tabela nova de **domínio** deve
usar `is_active_member(account_id)` — escopo pela empresa ATIVA. `is_account_member`
só para superfícies de pertença (seletor/roster).
<!-- SPECKIT END -->
