# Fase 0 — Pesquisa & Decisões

Feature: Janela de 24h proativa (`005-janela-24h`).

## Decisão 1 — Rastreio via coluna `last_inbound_at`

**Decisão**: adicionar `conversations.last_inbound_at TIMESTAMPTZ` (migration
`500_`), atualizada pelo webhook quando uma mensagem de **cliente** chega. A
janela é derivada: aberta se `now - last_inbound_at < 24h`.

**Justificativa**: escalável — leitura O(1) por conversa, sem varrer `messages`
a cada envio/abertura. O webhook já processa a mensagem de entrada; setar a
coluna é barato.

**Alternativa**: consultar `max(created_at)` de `messages` com
`sender_type='customer'` sob demanda. Sem migration, mas custo por leitura e não
escala. Rejeitada para o caminho de envio; aceitável só como fallback.

## Decisão 2 — Backfill das conversas existentes

**Decisão**: na migration, inicializar `last_inbound_at` a partir da última
mensagem de cliente conhecida (subquery em `messages`), quando existir; caso
contrário nulo (= janela fechada até a próxima entrada).

**Justificativa**: evita que toda conversa existente apareça como "fechada"
indevidamente logo após o deploy.

## Decisão 3 — Checagem no core + backstop 131047

**Decisão**: em `send-message.ts`, para envios **não-template**, checar a janela
e lançar `window_expired` **antes** de chamar a Meta. Templates passam sempre.
Adicionalmente, mapear o erro **131047** da Meta para a mesma mensagem (backstop
para corridas: a janela expira entre a checagem e o envio).

**Justificativa**: a checagem local dá UX clara e evita chamada desnecessária; o
backstop cobre o caso de corrida sem depender só do relógio local.

## Decisão 4 — Aviso proativo na inbox

**Decisão**: o `message-composer.tsx` recebe o estado da janela (derivado de
`last_inbound_at`, já disponível na conversa carregada) e, quando fechada,
sinaliza e oferece o seletor de template em vez de texto livre. Real-time já
existente reabre ao chegar mensagem.

## Fora de escopo

- Notificar o agente proativamente quando a janela está prestes a expirar
  (contador regressivo) — melhoria futura.
- Automatizar envio de template ao expirar — decisão de produto separada.
