# Implementation Plan: Motor de Leads — Recuperação Ativa + Alertas de Formato

**Branch**: autoria em `008-multi-conta`; implementação em branch própria a partir da `main` já com 008/009. | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

## Summary

Duas redes de segurança sobre o núcleo (009): (1) **recuperação ativa** — buscar
leadgen direto na Graph API da Meta por período, comparar por `meta_lead_id` e importar
só os ausentes (idempotente, reusa a entrega do 009), com auditoria; (2) **alertas de
formato** — detectar campo novo/removido/renomeado na normalização e sinalizar
(agrupado), sem interromper e preservando o bruto. Aditivo; duas tabelas novas.

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 16.
**Primary Dependencies**: núcleo do motor (009), Graph API da Meta (via `meta_apps`/007),
Supabase/RLS, i18n.
**Storage**: PostgreSQL — `lead_recovery_runs`, `lead_format_alerts`; reuso do ledger 009.
**Testing**: Vitest (idempotência da recuperação; agrupamento de alertas; não-interrupção).
**Target Platform**: Web (deploy por cliente; Supabase Cloud).
**Project Type**: Web application (Next.js + Supabase).
**Performance Goals**: recuperação sob demanda (volume baixo, janelas pontuais).
**Constraints**: idempotência por `meta_lead_id` (009); nunca interromper por alerta;
escopo por account (008); recuperação só Meta Form; migrations `517_`+.
**Scale/Scope**: 2 tabelas + fluxo de recuperação (UI+2 endpoints) + hook de alertas na
normalização + tela de alertas.

## Constitution Check

| Princípio | Avaliação | Status |
|---|---|:--:|
| I. Privacidade/LGPD | Recupera PII de leads (mesmo tratamento do 009). Sem novo operador. | ✅ |
| II. Segurança = autorização | Graph API com credenciais server-only (`meta_apps`); importação carimba o account (isolamento); tabelas novas com RLS/escopo. Revisão antes do merge. | ✅ (com revisão) |
| III. Só API oficial WhatsApp | Recuperação usa a Graph API oficial de leads. | ✅ |
| IV. Mudança dirigida por spec | Via spec/plan/tasks. | ✅ |
| V. Disciplina de merge com upstream | Aditivo (tabelas/rotas novas + hook na normalização do 009). Migrations `517_`+; divergências documentadas. | ✅ |
| VI. Hospedagem/isolamento | Sem mudança. | ✅ |
| VII. Manutenibilidade | Reuso do 009 (idempotência/entrega/normalização); só o pull e os alertas são novos. | ✅ |

**Resultado**: PASS. Obrigações: revisão de segurança (II) do endpoint de recuperação
(credenciais + isolamento); documentar divergências (V).

## Project Structure

```text
supabase/migrations/
├── 517_lead_recovery_runs.sql
└── 518_lead_format_alerts.sql

src/
├── app/api/leads/recovery/search/route.ts   # POST busca na Meta + diff
├── app/api/leads/recovery/import/route.ts    # POST importa ausentes (idempotente 009)
├── app/api/leads/format-alerts/route.ts      # GET lista de alertas (admin)
├── lib/leads/meta-recovery.ts                # Graph API pull + diff por meta_lead_id
├── lib/leads/format-detect.ts                # diff de chaves vs esperado → upsert alerta
├── lib/leads/normalize.ts                    # ESTENDER (009): chamar format-detect
├── components/leads/recovery/                # UI de recuperação (busca, seleção, import, auditoria)
├── components/admin/format-alerts/           # tela de alertas
└── i18n / messages/
```

**Structure Decision**: aditivo sobre o 009. A detecção de formato é um hook dentro de
`normalize.ts` (009) que faz upsert no alerta sem alterar o fluxo. A recuperação é um
fluxo próprio que reusa a normalização/entrega do 009 para importar.

## Complexity Tracking

> Sem violações. Recuperação limitada à origem Meta Form (única com "lista por período"
> na Meta) — decisão de escopo, não complexidade.
