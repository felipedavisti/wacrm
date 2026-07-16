# Checklist de Qualidade da Spec: Janela de 24h proativa

**Criada em**: 2026-07-16 · **Feature**: [spec.md](../spec.md)

## Qualidade de Conteúdo
- [x] Sem detalhes de implementação além do necessário
- [x] Focada em valor de usuário (erro claro em vez de rejeição crua)
- [x] Compreensível para stakeholders
- [x] Seções obrigatórias preenchidas

## Completude de Requisitos
- [x] Nenhum [NEEDS CLARIFICATION]
- [x] Requisitos testáveis
- [x] Critérios de sucesso mensuráveis e agnósticos
- [x] Cenários de aceitação definidos
- [x] Casos de borda (sem entrada, reabertura, fuso, backfill)
- [x] Escopo delimitado
- [x] Dependências e premissas (migration 500_) identificadas

## Prontidão
- [x] FRs com critérios claros
- [x] Cenários cobrem os fluxos primários
- [x] Atende aos Critérios de Sucesso
- [x] Sem vazamento de implementação

## Notas
- Análise: janela só em comentários (nunca validada); sem rastreio de entrada;
  erro 131047 não tratado. Decisão de rastreio (coluna last_inbound_at) no research.
- Primeira migration na faixa 500_ do fork.
