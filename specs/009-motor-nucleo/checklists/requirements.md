# Specification Quality Checklist: Motor de Leads — Núcleo

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — exceto onde a decisão de programa já fixou (pgmq/pg_cron), documentada como premissa
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (Site + Meta Form; CTWA=010; recuperação/alertas=011)
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Clarify (2026-07-20): Q1 praça dropada; Q2 lead = deal no funil + ledger de ingestão
  (reusa pipelines/deals/custom_fields, vários funis por empresa); Q3 painel por
  empresa ativa. `partially_sent` mantido como maquinário inerte com destino único.
- Decisões de programa herdadas: destino=CRM interno + abstração por conta; stack
  Next/Supabase (sem Go); outbox+pgmq+pg_cron. Ver [[programa-motor-leads]].
- Pronta para `/speckit-plan`.
