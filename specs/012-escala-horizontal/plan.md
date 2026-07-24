# Implementation Plan: Prontidão para Escala Horizontal

**Branch**: autoria em `009-motor-nucleo`; implementação em branch própria a partir da `main`. | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

## Summary

Corrigir os pontos onde o código assume **uma** instância, antes de subir para N
atrás de um balanceador. Quatro padrões de leitura-modificação-escrita não
atômicos (não lidas, variáveis de fluxo, histórico de automação, status de
mensagem), o limitador de uso em memória de processo, e a ausência total de
desligamento gracioso. Correção, não otimização: cada item produz **dado errado
ou efeito visível ao cliente** com N>1.

O repositório já tem o padrão certo em quatro lugares (`increment_*`,
`record_webhook_failure`, `claim_ai_reply_slot`, `claim_lead_delivery_jobs`) — o
trabalho é replicá-lo, não inventá-lo.

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 16.2.6.
**Primary Dependencies**: Supabase/Postgres (RPCs `SECURITY DEFINER`), backend de
contagem a definir para o limitador.
**Storage**: PostgreSQL — RPCs novas; colunas de lease; índice único em `messages`.
**Testing**: Vitest com execução concorrente real (`Promise.all` sobre o caminho
de produção), validada por mutação — remover a correção e confirmar que o teste
quebra.
**Target Platform**: Node de longa duração (`next start`) atrás de Cloudflare, N
instâncias.
**Project Type**: Web application (Next.js + Supabase).
**Performance Goals**: nenhuma. É correção; o custo aceitável é o de uma RPC a
mais por operação.
**Constraints**: os 16 pontos de chamada do limitador **não podem mudar**;
migrations a partir de `523_`; nenhuma regressão no isolamento por empresa
(lição da 512).
**Scale/Scope**: ~6 RPCs/migrations, 1 troca de implementação de limitador, 1
tratador de sinal, ~8 arquivos tocados.

## Constitution Check

| Princípio | Avaliação | Status |
|---|---|:--:|
| I. Privacidade/LGPD | Não muda o que é coletado nem exibido. A idempotência de mensagem **reduz** duplicação de PII. | ✅ |
| II. Segurança = autorização | O limitador global **restaura** um controle hoje contornável (`limite × N`); a correção do IP fecha uma segunda via de bypass. Nenhuma policy de RLS é tocada — a 512 não pode regredir. Revisão antes do merge. | ✅ (com revisão) |
| III. Só API oficial WhatsApp | Sem mudança de integração. | ✅ |
| IV. Mudança dirigida por spec | Spec + plan + tasks, com auditoria citada por arquivo e linha. | ✅ |
| V. Disciplina de merge com upstream | **Ponto de atenção.** Toca arquivos de upstream (`rate-limit.ts`, `webhook/route.ts`, `flows/engine.ts`, `status-mirror.ts`). Cada divergência precisa de comentário do porquê e registro em `docs/upstream-sync.md`. | ⚠️ (documentar) |
| VI. Hospedagem gerenciada / isolamento | O backend do limitador é infraestrutura nova — decidir preferindo gerenciado, e manter dev/prod separados. | ✅ (com decisão) |
| VII. Manutenibilidade para time pequeno | Replica um padrão que já existe em 4 lugares, em vez de introduzir abstração nova. O limitador troca por trás de uma interface estável. | ✅ |

## Project Structure

```
supabase/migrations/
  523_atomic_counters.sql        RPCs: unread_count, flow vars, reprompt,
                                 append de histórico de automação
  524_flow_run_claim.sql         claim/CAS em flow_runs
  525_message_idempotency.sql    índice único (conversation_id, message_id)
  526_pending_execution_lease.sql lease + recuperação de automações travadas

src/lib/rate-limit.ts            troca da implementação; interface intacta
src/lib/http/client-ip.ts        (novo) CF-Connecting-IP
src/lib/shutdown.ts              (novo) SIGTERM + janela de drenagem
src/instrumentation.ts           registra o tratador de sinal
src/lib/flows/engine.ts          claim antes de avançar; corrigir o comentário
src/lib/automations/engine.ts    appendResults via RPC
src/lib/whatsapp/status-mirror.ts guarda de monotonicidade
src/app/api/whatsapp/webhook/route.ts unread via RPC; insert idempotente
```

## Ordem de execução e por quê

1. **Contadores e claim de fluxo primeiro** (T001–T008). São correções
   independentes entre si e não dependem de decisão de infraestrutura. O de
   fluxo é o primeiro de todos: é o único com efeito visível ao cliente final.
2. **Decisão do limitador** (T009) em paralelo com o item 1 — é decisão de
   infraestrutura, não de código, e destrava T010.
3. **Desligamento gracioso e leases** (T014–T017) depois: mexem no ciclo de
   vida do processo e é melhor validá-los com o resto já estável.
4. **Fase 2 e 3** podem ir após o primeiro deploy multi-instância. As falhas já
   existiam com uma instância; só ficam mais frequentes.

## Estratégia de teste

O risco desta feature é escrever teste que **passa sem provar nada**. Duas
regras:

- **Concorrência de verdade**: `Promise.all` sobre o caminho real, não
  simulação sequencial com comentário dizendo "imagine que é paralelo".
- **Validação por mutação**: para cada correção, reintroduzir o bug e confirmar
  que o teste quebra. Foi assim que os 33 testes da 009 e os 7 do worker foram
  validados; sem isso não há evidência de que o teste cobre o que diz cobrir.

## Complexity Tracking

| Item | Complexidade | Justificativa |
|---|:--:|---|
| RPCs de contador | Baixa | Padrão já existe 4× no repositório |
| Claim de `flow_runs` | **Média** | O motor de fluxos tem estado conversacional; um claim mal desenhado trava run legítimo. Precisa de lease com expiração, não lock indefinido |
| Troca do limitador | Média | A interface protege os 16 pontos de chamada, mas o comportamento em indisponibilidade é decisão de produto (fail-open vs fail-closed) |
| `SIGTERM` + drenagem | **Média** | Interage com `after()` do Next e com o `maxDuration` das rotas. Janela curta demais não resolve; longa demais trava o deploy |
| Idempotência de mensagem | Baixa | Índice único + `ON CONFLICT` |
| Monotonicidade de status | Baixa | A lógica equivalente já existe para campanhas |

## Riscos

- **Claim de fluxo travando conversa legítima**: se o lease não expirar, uma
  instância morta deixa o cliente sem resposta. Mitigação: lease curto, com
  reclamação automática — o mesmo desenho do worker de leads.
- **Regressão de isolamento**: qualquer mexida em policy pode desfazer a
  correção da 512. Mitigação: esta feature **não toca policies**; se precisar,
  é sinal de que algo foi mal desenhado.
- **Divergência de upstream**: são arquivos que o upstream também altera.
  Mitigação: comentar cada divergência no código e registrar em
  `docs/upstream-sync.md` (Princípio V).

## Fora do plano

Observabilidade (spec 013), desempenho, e o buraco do espelho do n8n.
