# Sincronização com o Upstream (runbook)

Este documento operacionaliza o **Princípio V — Disciplina de Merge com o
Upstream** (`.specify/memory/constitution.md`). É o processo repetível para
puxar mudanças de `ArnasDon/wacrm` sem perder as customizações da Fnx Social.

> Doutrina em uma frase: **este fork não faz rebase contínuo**. Ele merge o
> upstream em uma branch dedicada, resolve, testa e registra o SHA — e prefere
> customização **aditiva** (arquivos novos) para que a maioria dos merges seja
> trivial.

## Estado da linha de base

| Item | Valor |
|---|---|
| Remote upstream | `https://github.com/ArnasDon/wacrm.git` (remote `upstream`) |
| SHA base incorporado | `b867760` (2026-07-10) |
| Topo do upstream medido | `b24aa79` (2026-07-17) — 23 commits à frente |
| Faixa de migrations do fork | `500_` (upstream está em `036`) — sem colisão |

O SHA base é **ancestral limpo** do upstream/main (sem rebase no upstream), então
os merges são lineares e re-executáveis.

## Mapa de calor de conflito

Cruzando os `plan.md` das specs 001–007 com o churn real do upstream. A previsão
inicial superestimou a zona de envio/webhook; o churn real está em **outra área**.

### Colisões reais medidas (base `b867760` → `b24aa79`)

Um único commit do upstream — **`292f52f feat(automations): dispatch tag added
triggers`** — toca três arquivos que specs nossas também tocam:

| Arquivo | Spec que colide | Churn upstream | Nota |
|---|---|---|---|
| `src/components/contacts/contact-detail-view.tsx` | **004** (reescreve) | +24 | 🔴 colisão direta — resolver junto ao merge da 004 |
| `src/lib/automations/engine.ts` | **001** (declara "inalterado") | +58 | 🟠 a 001 troca a assinatura chamada aqui; revalidar o adaptador |
| `src/lib/flows/engine.ts` | **001** (declara "inalterado") | +28 | 🟠 idem flows |
| `messages/en.json` | **002** (paridade en↔pt) | +2 | 🟢 re-rodar a verificação de paridade de chaves |

### Zona quente prevista — **fria neste range** (mas continua sendo a de maior risco futuro)

Nenhum destes mudou nos 23 commits, mas são os que o upstream historicamente mais
mexe. Manter as costuras (spec 001/006) reduz o custo quando mudarem:

- `src/app/api/whatsapp/webhook/route.ts` — specs 005, 006, 007
- `src/lib/whatsapp/send-message.ts` — specs 003, 005
- `src/app/api/whatsapp/config/route.ts` — specs 006, 007
- `src/lib/{automations,flows}/meta-send.ts` — spec 001
- `src/components/inbox/*` — specs 003, 005, 007
- `src/components/settings/whatsapp-config.tsx` — spec 007

### Aditivo puro (conflito zero, por construção)

`engine-send-base.ts`, `messages/pt.json`, migrations `500_+`,
`service-role-inventory.md`, novos `*.test.ts`. O upstream também adiciona de
forma aditiva (`messages/ko.json`, `src/lib/contacts/tag-*`) — sem conflito.

## Sequenciamento recomendado das specs

A ordem reduz a superfície de conflito porque as costuras vêm antes do trabalho
que se apoia nelas:

1. **001 (engine-send-base)** e **006 (hardening service_role)** — criam costuras;
   ao mergear a 001, **revalidar contra a mudança do upstream em `engine.ts`**.
2. **003, 005** — mudanças pontuais sobre `send-message`/webhook, já com costuras.
3. **004 (conversas na ficha)** — resolver a colisão em `contact-detail-view.tsx`
   contra `292f52f` no momento do merge.
4. **007 (multi-número)** — por último e **colado a um sync fresco**; é a área de
   maior risco (webhook + config + índice `036`). Divergência documentada em
   `docs/spec-multi-numero.md`.

## Runbook: sync periódico do upstream

```bash
# 1. Atualizar refs
git fetch upstream --no-tags

# 2. Ver o que chegou desde a base incorporada
git log --oneline b867760..upstream/main
git diff --stat b867760..upstream/main

# 3. Branch dedicada (nunca merge direto na main)
git switch -c sync/upstream-$(date +%Y-%m-%d)

# 4. Merge (NÃO rebase) — preserva histórico e é re-executável
git merge upstream/main

# 5. Resolver conflitos guiado pelo mapa de calor acima.
#    Preferir manter a costura do fork e reaplicar a lógica nova do upstream
#    dentro dela, em vez de reescrever o arquivo inteiro.

# 6. Portões de qualidade (herdados do upstream)
npm run typecheck && npm run build && npx vitest run

# 7. Registrar o novo SHA base em .specify/memory/constitution.md
#    (Princípio V, "Linha de base") e neste documento (tabela do topo).

# 8. PR → revisão obrigatória da superfície service_role / RLS se tocada
#    (Princípios I e II) → merge na main.
```

## Correções de segurança: cherry-pick imediato

Não esperar o sync periódico. O upstream mantém branches `security/*`
(ex.: `security/encrypt-aes-gcm`, `security/rate-limit-send-broadcast`):

```bash
git fetch upstream --no-tags
git log --oneline upstream/main -- <arquivo afetado>   # achar o commit
git switch -c fix/upstream-security-<slug>
git cherry-pick <sha>
npm run typecheck && npm run build && npx vitest run
# PR → merge; anotar o SHA cherry-picado aqui.
```

## Log de syncs

| Data | SHA base anterior | SHA base novo | Branch | Notas |
|---|---|---|---|---|
| 2026-07-18 | — | `b867760` | (setup) | Linha de base do fork registrada. Upstream em `b24aa79`, 23 commits à frente. |
| 2026-07-18 | `b867760` | `b24aa79` | `sync/upstream-2026-07-18` | Merge dos 23 commits **sem conflito** (main só tinha docs). typecheck ✅, vitest 643/645 ✅ (2 falhas ambientais de fuso em `date-utils`, passam sob TZ=UTC), `next build` ✅ com env placeholder. Colisão futura já identificada: commit `292f52f` (tag-added triggers) mexe em `contact-detail-view.tsx` (spec 004) e `automations/flows engine.ts` (spec 001 os assumia inalterados). |
