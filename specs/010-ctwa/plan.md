# Implementation Plan: Motor de Leads — CTWA

**Branch**: autoria em `008-multi-conta`; implementação em branch própria a partir da `main` já com 007/008/009. | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

## Summary

Capturar, no **webhook de WhatsApp que já existe (007)**, o `referral` de anúncios
Click-to-WhatsApp (vínculo `wamid → campanha`) e **criar imediatamente** o lead/negócio
(deal no funil) via o **núcleo do motor (009)**, atribuindo a campanha do referral. A
empresa do lead **já é conhecida** (o número pertence a um account — 007/008), então
não há de-para: o referral é atribuição, não roteamento. Qualificação/atribuição por IA
ficam para automações posteriores, agindo sobre o lead já criado. Extensão **aditiva**
de 007 e 009; uma tabela nova (`ctwa_referrals`).

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 16.
**Primary Dependencies**: webhook/inbox de WhatsApp (007), núcleo do motor (009:
ledger, deliver-internal, outbox), Supabase/RLS, i18n.
**Storage**: PostgreSQL — 1 tabela nova (`ctwa_referrals`); reuso de
`conversations`/`contacts`/`lead_ingestions`/`deals`.
**Testing**: Vitest (captura de referral, criação automática idempotente, parcial).
**Target Platform**: Web (deploy por cliente; Supabase Cloud).
**Project Type**: Web application (Next.js + Supabase).
**Performance Goals**: criação do lead ~imediata (dentro do processamento do webhook /
outbox); volume baixo.
**Constraints**: fail-closed reusa 007; nunca descartar (referral parcial → pendência);
idempotência por conversa; isolamento por account (008); migrations `516_`+.
**Scale/Scope**: 1 tabela + extensão do handler do webhook + gatilho de criação.

## Constitution Check

| Princípio | Avaliação | Status |
|---|---|:--:|
| I. Privacidade/LGPD | Referral = dado de campanha (não sensível); PII é a da conversa já existente. Inventário de operadores inalterado. | ✅ |
| II. Segurança = autorização | Reusa a verificação de assinatura do webhook (007) — **fail-closed mantido**. `ctwa_referrals` com RLS por account. Criação automática carimba o account da conversa — auditar isolamento. | ✅ (com revisão) |
| III. Só API oficial WhatsApp | É exatamente o canal oficial (CTWA via Cloud API/webhook). | ✅ |
| IV. Mudança dirigida por spec | Via spec/plan/tasks; decisão de produto (criação automática) no clarify. | ✅ |
| V. Disciplina de merge com upstream | Aditivo (1 tabela + extensão do handler). Migrations `516_`+; divergências documentadas. **Atenção**: toca `webhook/route.ts` (alto conflito de merge — já é superfície divergente do 007). | ✅ (com documentação) |
| VI. Hospedagem/isolamento | Sem mudança. | ✅ |
| VII. Manutenibilidade | Reuso máximo (007 + 009); só a captura e o gatilho são novos. | ✅ |

**Resultado**: PASS. Obrigações: revisão de segurança (II) do handler e da criação
automática; documentar a divergência no `webhook/route.ts` (V).

## Project Structure

```text
supabase/migrations/
└── 516_ctwa_referrals.sql        # ctwa_referrals (+RLS/índice)

src/
├── app/api/whatsapp/webhook/route.ts   # ESTENDER: detectar referral, chamar captura
├── lib/whatsapp/ctwa-referral.ts       # NOVO: parse/persist do referral
├── lib/leads/create-from-ctwa.ts       # NOVO: cria lead_ingestion + enfileira deal (009), idempotente
└── i18n / messages/                    # rótulos (badge CTWA, pendência de atribuição)
```

**Structure Decision**: extensão aditiva. O handler do webhook (007) ganha um passo
que detecta `referral` e delega para `ctwa-referral.ts` (persistência) e
`create-from-ctwa.ts` (criação via 009). Nenhuma rota pública nova; nenhuma mudança no
contrato do webhook com a Meta.

## Complexity Tracking

> Sem violações. Reuso de 007/009. Único ponto de atenção de merge: a edição no
> `webhook/route.ts` (superfície já divergente do upstream desde o 007) — manter o
> passo CTWA isolado numa função para minimizar a área tocada.
