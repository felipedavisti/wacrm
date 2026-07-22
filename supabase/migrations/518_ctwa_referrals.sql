-- ============================================================
-- 518_ctwa_referrals (spec 010 — captura de referral CTWA)
--
-- Quando alguém clica num anúncio Click-to-WhatsApp, a Meta manda o
-- bloco `referral` junto da PRIMEIRA mensagem da conversa — e só
-- dessa. Se não capturarmos ali, a atribuição some para sempre: não
-- existe API para perguntar depois "de qual anúncio veio esta
-- conversa". Por isso a captura é passiva e vem ANTES de qualquer
-- decisão de negócio (FR-038).
--
-- REALIDADE DO PAYLOAD (por que quase tudo aqui é NULLABLE):
-- a spec assumia que campanha/adset/criativo viriam no referral. Não
-- vêm. A Meta manda o ID DO ANÚNCIO (`source_id`) e o `ctwa_clid`;
-- nome de campanha e de adset exigem uma chamada à Graph API sobre
-- esse id, com token de marketing (`ads_read`) — que é outro escopo,
-- e nem toda conta terá. Então: gravamos o que chega, sempre; os
-- nomes ficam nulos até um enriquecimento posterior conseguir
-- preenchê-los. Nunca descartar (FR-007) vale aqui também.
--
-- `raw` guarda o bloco original íntegro: é a única defesa quando a
-- Meta muda o formato — reprocessa a partir do que foi recebido, em
-- vez de perder o que não soubemos ler na época (FR-042).
--
-- DIVERGÊNCIA: tabela nova, aditiva (Princípio V).
-- ============================================================

CREATE TABLE IF NOT EXISTS ctwa_referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Empresa dona. No CTWA não existe "lead sem empresa": o anúncio
  -- aponta para um número, e o número já pertence a uma conta
  -- (007/008). Por isso NOT NULL — e por isso o CTWA não precisa do
  -- de-para que o Site e o Meta Form precisam.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

  -- Mensagem que trouxe o referral. UNIQUE: a Meta reentrega webhook
  -- em caso de ack lento, e reentrega não pode virar segundo vínculo.
  wamid TEXT NOT NULL,

  -- O que a Meta realmente manda hoje:
  source_id TEXT,          -- id do anúncio (ou do post)
  source_type TEXT,        -- 'ad' | 'post'
  source_url TEXT,
  ctwa_clid TEXT,          -- correlaciona com o Ads Manager
  headline TEXT,
  body TEXT,

  -- Preenchidos só por enriquecimento posterior via Graph API.
  ad_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  -- NULL = nunca tentado; útil para reprocessar só o que falta.
  enriched_at TIMESTAMPTZ,

  raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência da captura (FR-040): reentrega do mesmo wamid é
-- absorvida pelo ON CONFLICT, não vira linha nova.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ctwa_referrals_wamid
  ON ctwa_referrals (wamid);

CREATE INDEX IF NOT EXISTS ix_ctwa_referrals_conversation
  ON ctwa_referrals (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_ctwa_referrals_account
  ON ctwa_referrals (account_id, created_at DESC);

-- Fila do enriquecimento pendente: o que tem anúncio mas ainda não
-- tem nome de campanha.
CREATE INDEX IF NOT EXISTS ix_ctwa_referrals_pending_enrichment
  ON ctwa_referrals (account_id)
  WHERE enriched_at IS NULL AND source_id IS NOT NULL;

ALTER TABLE ctwa_referrals ENABLE ROW LEVEL SECURITY;

-- Tabela de DOMÍNIO ⇒ escopo pela empresa ATIVA (lição da 512).
-- Leitura para membros; escrita nenhuma via PostgREST — quem grava é
-- o webhook, com service_role, fora do RLS. Deny-by-default fecha a
-- porta de forjar atribuição de campanha pela API.
DROP POLICY IF EXISTS ctwa_referrals_select ON ctwa_referrals;
CREATE POLICY ctwa_referrals_select ON ctwa_referrals FOR SELECT
  USING (is_active_member(account_id));

COMMENT ON TABLE ctwa_referrals IS
  'Vínculo wamid -> anúncio do Click-to-WhatsApp (spec 010, FR-038). '
  'Capturado na 1a mensagem da conversa; a Meta não reenvia. Nomes de '
  'campanha/adset exigem enriquecimento via Graph API (ads_read).';
