# Research — Recuperação Ativa + Alertas de Formato (Fase 0)

Duas redes de segurança sobre o núcleo 009. Reuso máximo (idempotência, entrega).

## D1 — Recuperação ativa: pull da Graph API + diff por `meta_lead_id`

- **Decisão**: um fluxo (UI + endpoint) que consulta a **Graph API da Meta** os leadgen
  de um período/formulário (credenciais via `meta_apps` da 007), compara com
  `lead_ingestions.meta_lead_id` e apresenta **existentes × ausentes**. Importar os
  ausentes = alimentá-los pela **mesma normalização/entrega do 009** (idempotente pelo
  unique `meta_lead_id`). Auditoria em `lead_recovery_runs`.
- **Rationale**: idempotência já garantida pelo 009 (evento e recuperação convergem sem
  duplicar). Só para **Meta Formulário** (tem "lista por período"); Site/CTWA não têm
  equivalente.
- **Escopo**: empresa ativa (008); importa para o account correto (roteamento 009).

## D2 — Alertas de formato: diff de chaves contra conjunto esperado

- **Decisão**: na normalização (009), comparar as chaves do payload contra o **conjunto
  esperado** da origem (Site: campos do formulário; Meta: campos do leadgen). Chave
  extra → alerta `unknown_field`; esperada ausente → `missing_field`; renomeado =
  best-effort (correlação novo+removido). Registrar em `lead_format_alerts`
  **agrupado** (origem+tipo+campo) com exemplo e 1ª/última ocorrência. **Nunca**
  interrompe o processamento; bruto sempre preservado (já é FR-004 do 009).
- **Rationale**: simples e robusto; o conjunto esperado é declarado no código da origem
  (fonte da verdade dos campos que o normalizador conhece).

## D3 — Escopo da tela de alertas

- **Decisão (default)**: alertas de formato são de **nível de deployment** (a origem é a
  mesma para todas as empresas) → tela **central admin** com filtro. Alternativa por
  empresa é menor e pode ser ajustada na implementação.

## Numeração de migrations

010 vai até `516`. A 011 segue em **`517_`+**. Divergências documentadas (Princípio V).

## Superfícies sensíveis (Constituição II)

- Endpoint de recuperação chama a Graph API com credenciais `meta_apps` (server-only);
  a importação carimba o account correto (isolamento).
- `lead_recovery_runs`/`lead_format_alerts` com RLS/escopo adequado.
