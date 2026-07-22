-- ============================================================
-- 519_lead_conversation_link (spec 010 — lead <-> conversa)
--
-- O lead de CTWA nasce DE uma conversa, mas até agora esse vínculo
-- só existia de lado: `ctwa_referrals.conversation_id` e, pior, na
-- string do `dedup_key` ("ctwa:<uuid>"). Ler um relacionamento
-- fazendo parse de string é o tipo de coisa que funciona até o dia
-- em que alguém muda o formato da chave.
--
-- Aqui o vínculo vira o que sempre foi: uma coluna com FK. Isso
-- habilita as duas perguntas que a operação faz:
--   1. "abre a conversa deste lead"      -> lead   -> conversa
--   2. "que conversa de anúncio NÃO virou lead?" -> conversa -> lead
--
-- ON DELETE SET NULL (e não CASCADE): apagar uma conversa não pode
-- apagar o lead. O lead é o registro comercial — ele sobrevive ao
-- canal que o originou.
--
-- Nullable de propósito: lead de Site e de Meta Form não tem
-- conversa. Só o CTWA preenche.
--
-- DIVERGÊNCIA: aditivo (Princípio V).
-- ============================================================

ALTER TABLE lead_ingestions
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES conversations(id) ON DELETE SET NULL;

COMMENT ON COLUMN lead_ingestions.conversation_id IS
  'Conversa que originou o lead (só CTWA, spec 010). Permite abrir a '
  'conversa a partir do lead e achar conversas de anúncio sem lead.';

-- Suporta as duas direções da consulta, e o LEFT JOIN que procura
-- conversa de anúncio sem lead.
CREATE INDEX IF NOT EXISTS ix_lead_ingestions_conversation
  ON lead_ingestions (conversation_id)
  WHERE conversation_id IS NOT NULL;

-- Backfill do que já existe: até agora o vínculo estava embutido no
-- dedup_key. Extrai uma vez e nunca mais dependemos disso.
UPDATE lead_ingestions
SET conversation_id = NULLIF(substring(dedup_key FROM 6), '')::uuid
WHERE source = 'meta_ctwa'
  AND conversation_id IS NULL
  AND dedup_key LIKE 'ctwa:%'
  -- Só o que de fato é UUID; um dedup_key malformado não pode
  -- derrubar a migration.
  AND substring(dedup_key FROM 6) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
