-- ============================================================
-- 522_lead_welcome (spec 009, FR-047 — saudação do lead de formulário)
--
-- O PROBLEMA: lead de formulário/site chega com telefone e SEM
-- conversa. A pessoa nunca escreveu para a gente, e as regras do
-- WhatsApp proíbem iniciar em texto livre — só por template
-- aprovado. Sem isso, o vendedor tem que abrir cada conversa na mão.
--
-- NÃO se aplica ao CTWA: ali o cliente já escreveu (e a própria Meta
-- já mostra a saudação configurada no anúncio). A config vive em
-- `account_lead_sources`, que só existe para form_id/filial, então a
-- exclusão do CTWA é estrutural, não uma checagem que alguém pode
-- esquecer.
--
-- DESLIGADO POR PADRÃO, e a granularidade é POR ORIGEM (por
-- formulário / por filial), não por empresa. Duas razões:
--   1. homologar exige receber lead sem disparar mensagem para
--      cliente real — o default FALSE garante isso;
--   2. filiais diferentes têm operações diferentes; uma pode querer
--      automatizar e outra não.
--
-- `welcome_sent_at` no lead é o que impede reenvio: reprocessar uma
-- entrega não pode mandar "olá" de novo para quem já recebeu. Marca
-- no LEAD (e não no contato) porque duas oportunidades distintas da
-- mesma pessoa merecem, cada uma, sua saudação.
--
-- DIVERGÊNCIA: aditivo (Princípio V).
-- ============================================================

-- ---- Config por origem -------------------------------------------
ALTER TABLE account_lead_sources
  ADD COLUMN IF NOT EXISTS welcome_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE account_lead_sources
  ADD COLUMN IF NOT EXISTS welcome_template_name TEXT;

ALTER TABLE account_lead_sources
  ADD COLUMN IF NOT EXISTS welcome_template_language TEXT NOT NULL DEFAULT 'pt_BR';

-- Qual número envia. A empresa pode ter N números (spec 007) e o
-- lead não veio de nenhum deles — então alguém precisa escolher.
-- NULL = o primeiro número da empresa, mesmo critério do resto da API.
ALTER TABLE account_lead_sources
  ADD COLUMN IF NOT EXISTS welcome_whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

COMMENT ON COLUMN account_lead_sources.welcome_enabled IS
  'Dispara template de boas-vindas quando um lead desta origem entra '
  '(spec 009, FR-047). FALSE por padrão — homologação recebe lead sem '
  'falar com cliente real.';

-- Ligar sem dizer QUAL template não é uma configuração válida: seria
-- uma origem que tenta enviar e falha em toda entrega.
ALTER TABLE account_lead_sources
  DROP CONSTRAINT IF EXISTS chk_welcome_needs_template;
ALTER TABLE account_lead_sources
  ADD CONSTRAINT chk_welcome_needs_template
  CHECK (
    welcome_enabled = FALSE
    OR (welcome_template_name IS NOT NULL AND btrim(welcome_template_name) <> '')
  );

-- ---- Marca no lead -----------------------------------------------
ALTER TABLE lead_ingestions
  ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ;

-- O motivo da falha fica no lead: "por que esse não recebeu?" é
-- pergunta de operação, e a resposta não pode viver só no log do
-- servidor.
ALTER TABLE lead_ingestions
  ADD COLUMN IF NOT EXISTS welcome_error TEXT;

COMMENT ON COLUMN lead_ingestions.welcome_sent_at IS
  'Quando a saudação foi enviada. NOT NULL = não reenviar, nem em '
  'reprocessamento (spec 009, FR-047).';
