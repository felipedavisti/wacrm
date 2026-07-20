# Especificação de Feature: Motor de Leads — CTWA (anúncio Click-to-WhatsApp)

**Feature Branch**: autoria em `008-multi-conta` (programa Motor de Leads); implementação em branch própria.

**Created**: 2026-07-20

**Status**: Draft

**Input**: Origem CTWA da spec externa do Motor, adaptada ao CRM — que **já tem** a inbox de WhatsApp e o webhook (007). O anúncio aponta para o número na nossa caixa; a conversa já cai na inbox. Falta: **capturar o referral** (dados do anúncio na 1ª mensagem) e **promover a conversa a lead/negócio** com a campanha atribuída.

## Contexto e Problema

CTWA é a origem de **maior risco de perda de atribuição**: a conversa entra pelo WhatsApp e, sem captura, o dado de campanha (qual anúncio gerou o contato) se perde. Diferente do Site e do Meta Form (que criam lead na ingestão — feature 009), no CTWA **a conversa já existe** na inbox do CRM (007). Esta feature tem **duas superfícies**:

1. **Captura de referral (passiva)** — o webhook de WhatsApp, que já roda, seleciona as mensagens que trazem dados de anúncio (`referral`, tipicamente a 1ª da conversa) e guarda o vínculo `wamid → campanha`.
2. **Criação de lead sob demanda** — quando a conversa é qualificada, ela é **promovida a lead/negócio** (deal no funil, feature 009), e o motor resolve a campanha pelo referral capturado.

Depende de: **008** (empresa = account), **009** (ledger, roteamento, deal no funil, destino), **007** (webhook/inbox de WhatsApp).

## Clarifications

### Session 2026-07-20

- Q: Como uma conversa CTWA vira lead? → A: **Automático e imediato.** Toda conversa CTWA com `referral` gera o lead/negócio **na hora** da chegada (não sob demanda). A **qualificação e a atribuição por IA** vêm **depois**, como **automações** (fora desta 010) — o lead é criado de imediato justamente para a automação ter sobre o que agir.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Captura passiva do referral do anúncio (Priority: P1)

Como marketing, quero que, quando alguém iniciar uma conversa por um anúncio Click-to-WhatsApp, os dados do anúncio (campanha, adset, criativo, conta) sejam capturados automaticamente e vinculados à conversa, para não perder a atribuição — mesmo antes de virar lead.

**Why this priority**: é a rede de captura; sem ela, a atribuição some e não há como reconstruir depois.

**Independent Test**: enviar ao webhook o espelho de uma 1ª mensagem CTWA com `referral` e verificar que o vínculo `wamid → campanha` (campanha, adset, criativo, conta) foi armazenado e vinculado à conversa; **nenhum** lead é criado ainda.

**Acceptance Scenarios**:

1. **Given** uma mensagem CTWA com `referral`, **When** chega ao webhook, **Then** o vínculo `wamid → dados da campanha` é armazenado e associado à conversa; nenhum lead é criado.
2. **Given** mensagens **sem** `referral` (não são a 1ª da conversa), **When** chegam, **Then** são ignoradas para atribuição (não geram vínculo nem lead).
3. **Given** o webhook com assinatura inválida, **When** chega, **Then** é rejeitado (fail-closed, reusa 007) — nada é capturado.

---

### User Story 2 — Conversa CTWA vira lead/negócio automaticamente, na hora (Priority: P1)

Como marketing, quero que toda conversa iniciada por anúncio CTWA gere **imediatamente** um lead (negócio no funil), com a campanha já atribuída, para não depender de ação humana e ter a oportunidade rastreável desde o primeiro contato.

**Why this priority**: é onde o CTWA vira valor no CRM — a oportunidade rastreável, criada no ato.

**Independent Test**: enviar ao webhook uma 1ª mensagem CTWA com referral e verificar que um `deal` é criado **automaticamente** no funil, vinculado ao contato/conversa, com os 6 campos de rastreamento (sem o ID do formulário) a partir do referral.

**Acceptance Scenarios**:

1. **Given** uma 1ª mensagem CTWA com referral, **When** chega ao webhook, **Then** o referral é capturado **e** um `deal` é criado **imediatamente** no funil da empresa correta, vinculado ao contato/conversa existentes, com origem WhatsApp/CTWA e os 6 campos de rastreamento (via 009).
2. **Given** a criação automática, **When** o motor resolve a empresa, **Then** usa o roteamento (009) pela campanha do referral; sem de-para, cai na pendência de roteamento — nunca perde.
3. **Given** novas mensagens na mesma conversa (ou reentrega), **When** chegam, **Then** não duplicam o lead — idempotência por conversa/wamid (um deal por conversa CTWA).
4. **Given** a qualificação/atribuição por IA (automação futura), **When** roda, **Then** age sobre o lead **já criado** — a criação não espera a IA.

---

### User Story 3 — Referral incompleto não bloqueia a criação (Priority: P2)

Como marketing, quero que, mesmo quando o referral vier **incompleto** (faltando campos de campanha), o lead ainda seja criado, com a pendência de atribuição sinalizada, para nunca descartar uma oportunidade CTWA.

**Why this priority**: garante o "nunca perder" também quando a Meta entrega o referral parcial.

**Independent Test**: enviar uma conversa CTWA com referral **parcial** e verificar que o deal é criado com os campos disponíveis e a ausência sinalizada.

**Acceptance Scenarios**:

1. **Given** uma conversa CTWA com referral **parcial** (faltam campos), **When** chega, **Then** o deal é criado com o que existe e a **pendência de atribuição** é sinalizada — nunca descartado.
2. **Given** dados de campanha chegarem depois (mensagem tardia), **When** capturados, **Then** o vínculo é atualizado e pode **completar** a atribuição do lead já criado.

---

### Edge Cases

- **Conversa já existe** (contato recorrente) e chega novo referral: o vínculo mais recente é registrado; a promoção usa o referral aplicável.
- **Referral parcial** (faltam campos): o que existir é gravado; a ausência vira pendência sinalizada, nunca descarte.
- **Promoção concorrente** (dois atendentes): idempotente por conversa — não cria dois deals.
- **Número multi-conta** (007): o referral e o lead nascem na empresa/número corretos (a conversa já é por número/empresa).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-038**: **Captura de referral (passiva)**. O webhook de WhatsApp (007) DEVE selecionar as mensagens que contêm `referral` (dados de anúncio — tipicamente a 1ª da conversa) e armazenar o vínculo `wamid → dados da campanha` (campanha, adset, criativo, conta), associado à **conversa** (e à empresa/número dela). Mensagens sem referral são ignoradas para atribuição. A captura **não** cria lead.
- **FR-039**: **Criação de lead automática e imediata**. Ao chegar uma conversa CTWA com `referral` (FR-038), o sistema DEVE criar **imediatamente** o lead/negócio: resolve a campanha pelo referral, resolve a empresa pelo roteamento (009) e cria o `deal` no funil com os **6 campos** de rastreamento aplicáveis (sem ID do formulário), vinculado ao contato/conversa já existentes. A criação **não** espera qualificação humana ou de IA.
- **FR-043**: A **qualificação e a atribuição por IA** do lead CTWA são **automações posteriores** (fora desta 010) que agem sobre o lead **já criado**. A 010 entrega o lead criado no ato; a inteligência que qualifica/atribui pluga depois (módulo de automações/agentes).
- **FR-007**: Quando o referral não existir, o lead DEVE ser criado mesmo assim, com **pendência de atribuição** sinalizada (nunca descartado).
- **FR-040**: A promoção DEVE ser **idempotente por conversa** — promover a mesma conversa duas vezes não cria dois deals.
- **FR-041**: Referral e lead DEVEM nascer na **empresa/número corretos** (a conversa já é escopada por número/empresa — 007/008); o isolamento por account não regride.
- **FR-042**: O referral bruto DEVE ser preservado (auditoria/atribuição posterior), como o payload bruto do 009.

### Key Entities

- **Referral CTWA**: vínculo `wamid → campanha` (campanha, adset, criativo, conta, url, ctwa_clid), associado à conversa/empresa; referral bruto preservado. Populado pela captura (FR-038); consultado na promoção (FR-039).
- **Conversa (007)**: já existe; ganha o vínculo do referral e, quando promovida, origina o deal.
- **Lead/Deal (009)**: a promoção cria o `deal` no funil com o rastreamento do referral.

## Success Criteria *(mandatory)*

- **SC-CTWA-1**: 100% das 1ªs mensagens CTWA com referral têm o vínculo `wamid → campanha` capturado (0 atribuições perdidas por falta de captura).
- **SC-CTWA-2**: 100% das conversas promovidas a lead geram o `deal` no funil com os 6 campos de rastreamento aplicáveis quando o referral existe.
- **SC-CTWA-3**: Conversas promovidas **sem** referral geram lead com pendência de atribuição visível — 0 descartes.
- **SC-CTWA-4**: Promover a mesma conversa 2x nunca duplica o deal.

## Assumptions

- O webhook e a inbox de WhatsApp (007) estão no lugar; a captura de referral é uma extensão **aditiva** do handler existente (reusa a validação de assinatura — fail-closed).
- A criação do deal reusa o destino interno da 009 (contact/conversa já existem → cria o deal, dispensando criar contato/conversa).
- Os 6 campos de rastreamento CTWA = os 7 do Meta Form menos o ID do formulário (009, FR-005).
- LGPD: referral (dado de campanha, não sensível) e vínculo retidos; PII já é a da conversa existente.

## Fora de Escopo (da 010)

- A ingestão de Site/Meta Form (009) e a recuperação ativa/alertas (011).
- **Qualificação e atribuição por IA** do lead CTWA — são **automações posteriores** (módulo de automações/agentes) que agem sobre o lead **já criado** (FR-043). A 010 só garante a criação imediata.
- Alterar o comportamento da inbox/conversa além da captura do referral e da criação automática do lead.

## Dependências

- **007** (webhook/inbox de WhatsApp; validação de assinatura; conversas por número).
- **008** (empresa = account; isolamento).
- **009** (ledger, roteamento campanha→empresa, deal no funil, rastreamento, destino).
