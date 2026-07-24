# Implementation Plan: Observabilidade e Operação

**Branch**: autoria em `009-motor-nucleo`; implementação em branch própria a partir da `main`. | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

## Summary

Dar ao sistema a capacidade de dizer que parou. Hoje as garantias de entrega são
fortes depois que o evento entra — mas **nada expõe se o worker está vivo**, não
há endpoint de saúde, os 284 registros de log são texto livre sem correlação nem
identificador de instância, e a tabela de eventos rejeitados nunca teve tela.

O critério de priorização é um só: **cobrir primeiro as falhas que parecem
sucesso**. Falha visível já é tratada — o painel de leads mostra erro por
tentativa e permite reprocessar. O que mata é o silêncio.

Sem dependência externa de APM. O identificador de correlação e os logs
estruturados são pré-requisito de qualquer ferramenta futura, então nada aqui se
perde se um dia entrar uma.

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 16.2.6.
**Primary Dependencies**: nenhuma nova. Log estruturado escrito à mão (o
Princípio VII desaconselha dependência para o que cabe em um arquivo).
**Storage**: PostgreSQL — tabela de heartbeat de instância; reuso de
`lead_rejected_events` (já populada desde a 009).
**Testing**: Vitest — heartbeat obsoleto sinaliza; endpoint de saúde responde com
Auth fora e falha com banco fora; correlação atravessa o trabalho assíncrono.
**Target Platform**: Node de longa duração, N instâncias atrás de Cloudflare.
**Project Type**: Web application (Next.js + Supabase).
**Performance Goals**: a instrumentação não pode entrar no caminho crítico —
falha ao registrar telemetria nunca derruba entrega (FR-069).
**Constraints**: endpoint de saúde é **público** (o balanceador não autentica) —
não pode vazar segredo, versão de dependência nem dado de cliente; migrations a
partir de `527_`; o que a tela de rejeitados exibe é PII de terceiro **não
aceito** no sistema (Constituição I).
**Scale/Scope**: 1 tabela, 1 endpoint público, 1 módulo de log, 1 tela, ~10
arquivos tocados na primeira fase.

## Constitution Check

| Princípio | Avaliação | Status |
|---|---|:--:|
| I. Privacidade/LGPD | **Ponto de atenção.** Log estruturado tenta atrair `contact_id`, telefone, conteúdo de mensagem. A regra: log carrega **identificadores**, nunca conteúdo pessoal — o mesmo critério já aplicado na captura de CTWA (loga as chaves do payload, não os valores). A tela de rejeitados exibe payload de terceiro e precisa de tratamento explícito. | ⚠️ (regra explícita) |
| II. Segurança = autorização | Endpoint de saúde é público por natureza: superfície nova, precisa de revisão. A tela de rejeitados é owner, como o painel de leads (expõe PII). | ⚠️ (revisão obrigatória) |
| III. Só API oficial WhatsApp | Se o alerta sair por WhatsApp, usa a mesma API oficial e respeita a janela de 24h/template. | ✅ |
| IV. Mudança dirigida por spec | Spec + plan + tasks, com a auditoria citada por arquivo e linha. | ✅ |
| V. Disciplina de merge com upstream | Majoritariamente aditivo (arquivos novos). A migração dos 284 logs é o ponto de atrito — por isso é incremental e começa só pelos caminhos críticos. | ✅ |
| VI. Hospedagem gerenciada / isolamento | Nenhuma infraestrutura nova nesta fase. | ✅ |
| VII. Manutenibilidade para time pequeno | Sem APM, sem dependência. Um ajudante de log e uma tabela. O que não couber assim, não entra nesta fase. | ✅ |

## Project Structure

```
supabase/migrations/
  527_worker_heartbeat.sql       heartbeat por instância

src/app/api/health/route.ts      (novo) público, fora do middleware
src/middleware.ts                gera e propaga a correlação; exclui /api/health
src/lib/observability/
  instance.ts                    (novo) identificador de instância
  correlation.ts                 (novo) geração e propagação
  log.ts                         (novo) log estruturado
src/lib/leads/worker-loop.ts     grava heartbeat a cada tique
src/lib/leads/worker.ts          distingue "falhou o claim" de "sem trabalho"
src/app/api/leads/health/…       estado da entrega para o painel
src/app/(dashboard)/leads/…      faixa de estado do worker
src/app/(dashboard)/leads/rejeitados/ (nova tela)
```

## Ordem de execução e por quê

1. **Heartbeat + endpoint de saúde** (T001–T010). São os dois que **bloqueiam a
   escala horizontal** — o balanceador precisa do endpoint, e o heartbeat é a
   única defesa contra o modo de falha mais provável (instância sem a variável
   de ambiente do worker).
2. **Correlação e log estruturado** (T011–T016). Depois, porque é onde mora o
   risco de virar refatoração infinita: migrar **só** webhook, ingestão e
   worker. Os outros 284 ficam como estão até doerem.
3. **Tela de rejeitados** (T017–T020). Independente; pode ir em paralelo.
4. **Alertas** (T021–T025) por último na Fase 2 — não se alerta sobre sinal que
   não existe. Depende do heartbeat.

## Decisões em aberto que o plano não fecha

- **Canal do alerta** (T021). Existe WhatsApp e n8n na casa. O requisito é que
  o alerta **saia do sistema**; o canal é decisão de operação.
  **Ressalva importante**: se o alerta depender do próprio CRM, o CRM caído não
  avisa. Vale um canal minimamente independente para a condição "está tudo
  fora".
- **Limite de "worker parado"**: quantos minutos sem tique antes de sinalizar.
  Depende do intervalo configurado; sugestão de partir de 3× o intervalo.

## Estratégia de teste

- **Heartbeat**: relógio controlado, verificar que obsoleto sinaliza e que
  religar normaliza.
- **Saúde**: os dois lados — responde com o Auth fora (é o ponto), e **não**
  responde saudável com o banco fora (senão a sonda mente).
- **Correlação**: um evento rastreável de ponta a ponta, incluindo o trecho que
  roda em `after()`.
- **Não-interferência**: forçar falha na telemetria e verificar que a entrega
  acontece assim mesmo (FR-069). Este é o teste que impede a observabilidade de
  virar causa de incidente.

## Complexity Tracking

| Item | Complexidade | Justificativa |
|---|:--:|---|
| Heartbeat | Baixa | Uma tabela, uma escrita por tique |
| Endpoint de saúde | **Média** | Precisa ficar fora do matcher do middleware sem abrir buraco; e decidir o que conta como "saudável" — responder 200 só porque o processo vive é sonda que mente |
| Correlação | Média | Propagar para dentro de `after()` exige cuidado; sem isso o trecho mais importante fica sem rastro |
| Log estruturado | **Média** | Não pela técnica, pelo escopo: 284 pontos convidam a uma refatoração que nunca termina. Mitigado por migrar só 3 caminhos |
| Tela de rejeitados | Baixa | Rota de leitura + tela, padrão do painel existente |
| Alertas | **Média** | Agrupamento e sinal de recuperação são o que separa alerta útil de ruído ignorado |

## Riscos

- **Refatoração infinita dos logs**: o maior risco desta spec. Mitigação: a
  tarefa T014 diz explicitamente "**não** os 284 de uma vez".
- **PII vazando para o log**: mitigação na regra do Princípio I acima —
  identificadores sim, conteúdo não.
- **Endpoint de saúde como superfície de ataque**: é público. Mitigação:
  responder o mínimo, e revisão de segurança obrigatória (T028).
- **Alerta que ninguém lê**: sem agrupamento, uma falha ruidosa gera centenas
  de mensagens e treina o time a ignorar. Mitigação: T023 e T024 não são
  opcionais.
- **Sonda mentirosa**: um health que só confirma o processo vivo dá falsa
  segurança e o balanceador mantém no pool uma instância que não trabalha.
  Mitigação: T008.

## Fora do plano

Correção sob concorrência (spec 012), APM/tracing distribuído, auditoria de
acesso LGPD (segue fora de escopo desde a 003), e o buraco do espelho do n8n —
que exige trabalho no fluxo deles, não no CRM.
