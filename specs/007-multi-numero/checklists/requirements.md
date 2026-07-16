# Checklist de Qualidade da Spec: Múltiplos números por conta

**Criada em**: 2026-07-16 · **Feature**: [spec.md](../spec.md)

## Qualidade de Conteúdo
- [x] Sem detalhes de implementação além do necessário (schema detalhado no doc de design)
- [x] Focada em valor de usuário (operar N números)
- [x] Compreensível para stakeholders
- [x] Seções obrigatórias preenchidas

## Completude de Requisitos
- [x] Nenhum [NEEDS CLARIFICATION] — as 6 decisões de produto já estão tomadas
- [x] Requisitos testáveis
- [x] Critérios de sucesso mensuráveis e agnósticos
- [x] Cenários de aceitação definidos (6 user stories)
- [x] Casos de borda (índice 036, flow_runs, App de terceiro, rotação, entrada já ok)
- [x] Escopo delimitado (axioma de dados; design detalhado no doc)
- [x] Dependências identificadas (001 pré-requisito; 004/006 complementam)

## Prontidão
- [x] FRs com critérios claros
- [x] Cenários cobrem os fluxos primários
- [x] Atende aos Critérios de Sucesso
- [x] Sem vazamento de implementação além do referenciado no doc

## Notas
- É a maior spec do backlog e uma **mudança de axioma**. Design detalhado
  (schema, ~13 call sites, riscos) em `docs/spec-multi-numero.md`.
- **Pré-requisito real**: a costura `resolveConfig` da 001. Recomenda-se
  implementar a 001 antes.
- Risco central: o índice da migration 036 (fusão silenciosa de threads).
