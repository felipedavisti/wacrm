# Checklist de Qualidade da Spec: Endurecimento service_role

**Criada em**: 2026-07-16 · **Feature**: [spec.md](../spec.md)

## Qualidade de Conteúdo
- [x] Sem detalhes de implementação além do necessário
- [x] Focada em valor (garantia de isolamento comprovada)
- [x] Compreensível para stakeholders
- [x] Seções obrigatórias preenchidas

## Completude de Requisitos
- [x] Nenhum [NEEDS CLARIFICATION]
- [x] Requisitos testáveis
- [x] Critérios de sucesso mensuráveis
- [~] Critérios de sucesso agnósticos — parcialmente; um refere-se a cobertura de teste/inventário (natureza de hardening; aceito com nota)
- [x] Cenários de aceitação definidos
- [x] Casos de borda (webhook por número, cron, api key inválida, account_id ausente)
- [x] Escopo delimitado (o que IGNORA a RLS; não os caminhos RLS)
- [x] Dependências e premissas identificadas

## Prontidão
- [x] FRs com critérios claros
- [x] Cenários cobrem os fluxos primários
- [x] Atende aos Critérios de Sucesso
- [x] Sem vazamento de implementação além do inerente a hardening

## Notas
- Spec de hardening: o "produto" é garantia de isolamento + testes + convenção.
  SC-002/SC-004 medem cobertura/inventário por serem o objetivo. Aceito.
- Superfície mapeada: 3 admin-clients + webhook + config + api-keys + helpers de
  envio + crons.
