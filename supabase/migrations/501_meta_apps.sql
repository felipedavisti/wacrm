-- ============================================================
-- 501_meta_apps (spec 007 — multi-número)
--
-- A hierarquia real da Meta é App → WABA → número. O app_secret e o
-- verify_token pertencem ao **App**, não ao número: guardá-los por número
-- duplicaria o mesmo segredo em N linhas e tornaria a rotação um update em
-- N lugares. Esta tabela os move do `.env` para o banco (criptografados com
-- a mesma ENCRYPTION_KEY, AES-256-GCM), por conta.
--
-- N `whatsapp_config` apontam para um `meta_apps` via `meta_app_id`.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_apps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL,     -- AES-256-GCM
  verify_token TEXT NOT NULL,   -- AES-256-GCM
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_apps_account ON meta_apps(account_id);

-- RLS: mesma tenancy das demais tabelas (is_account_member, migration 017).
ALTER TABLE meta_apps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_apps_rw ON meta_apps;
CREATE POLICY meta_apps_rw ON meta_apps FOR ALL
  USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- Vínculo número → App. Nullable: configs existentes (single-número) seguem
-- usando o META_APP_SECRET do env como fallback até serem migradas para um
-- meta_app. Divergência deliberada do upstream (Princípio V).
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS meta_app_id UUID REFERENCES meta_apps(id) ON DELETE SET NULL;
