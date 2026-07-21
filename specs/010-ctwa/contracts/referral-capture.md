# Contrato — Captura de referral + criação automática (interno ao webhook)

Não há endpoint público novo: a 010 estende o **webhook de WhatsApp (007)**. O
contrato é comportamental.

## Entrada: mensagem CTWA no webhook (007)

Uma mensagem de entrada pode conter um objeto `referral` (Meta) quando a conversa
foi iniciada por um anúncio Click-to-WhatsApp. Campos típicos:
`source_url`, `source_id`, `headline`, `body`, `ctwa_clid`, e os ids de
campanha/adset/anúncio conforme o tipo de mensagem.

## Comportamento (fail-closed reusa 007)

1. **Assinatura inválida** → rejeitado pelo 007 (nada é capturado).
2. **Mensagem sem `referral`** → ignorada para atribuição (nenhum vínculo, nenhum lead).
3. **Mensagem com `referral`**:
   a. Grava `ctwa_referrals` (wamid → campanha, `account_id` = account da conversa,
      `raw` preservado).
   b. Se a conversa **ainda não tem** lead CTWA: cria `lead_ingestions`
      (`source='meta_ctwa'`) e enfileira a entrega (009) que cria o **`deal`** no funil
      de entrada do account, vinculado ao contato/conversa. Marca
      `ctwa_referrals.lead_ingestion_id`.
   c. Referral **parcial** → o deal é criado com os campos disponíveis e **pendência de
      atribuição** sinalizada (FR-007).
4. **Reentrega / novas mensagens** na mesma conversa → **não** cria segundo deal
   (idempotência por `conversation_id`, FR-040).

## Saída (efeitos observáveis)

- `ctwa_referrals` populado; um `deal` no funil da empresa correta com os 6 campos de
  rastreamento; o lead visível no painel do motor (009) da empresa ativa.
- Nenhuma resposta HTTP nova (o webhook 007 já responde 200 à Meta).

## Não faz parte do contrato

- Qualificar/atribuir o lead (automação futura, FR-043) — age sobre o deal já criado.
