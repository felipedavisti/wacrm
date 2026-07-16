# Checklist de Qualidade da Spec: Atribuição de autor da mensagem

**Objetivo**: validar completude e qualidade da spec antes de planejar
**Criada em**: 2026-07-16
**Feature**: [spec.md](../spec.md)

## Qualidade de Conteúdo

- [x] Sem detalhes de implementação além do necessário (cita colunas/rotas como contexto)
- [x] Focada em valor de usuário e necessidade de negócio (atribuição de autoria)
- [x] Escrita de forma compreensível para stakeholders
- [x] Todas as seções obrigatórias preenchidas

## Completude de Requisitos

- [x] Nenhum marcador [NEEDS CLARIFICATION] restante
- [x] Requisitos testáveis e não-ambíguos
- [x] Critérios de sucesso mensuráveis
- [x] Critérios de sucesso agnósticos de tecnologia
- [x] Todos os cenários de aceitação definidos
- [x] Casos de borda identificados (bot, cliente, API, agente removido, msg antiga)
- [x] Escopo claramente delimitado (atribuição de saída ≠ auditoria de leitura LGPD)
- [x] Dependências e premissas identificadas

## Prontidão da Feature

- [x] Todos os requisitos funcionais têm critérios de aceitação claros
- [x] Cenários de usuário cobrem os fluxos primários
- [x] A feature atende aos resultados mensuráveis dos Critérios de Sucesso
- [x] Sem vazamento de detalhes de implementação na especificação

## Notas

- Análise de "pontas soltas" concluída: mapeados TODOS os inserts em `messages`
  (1 agente, 4 bot, 1 customer, 4 otimistas de UI; broadcast não insere), o
  ponto onde o agente autenticado está disponível (rota `/api/whatsapp/send`), e
  a omissão de `sender_id` na API pública (já existente, a preservar).
- Escopo pequeno e de baixo risco; **sem migration** (coluna + tipo já existem).
