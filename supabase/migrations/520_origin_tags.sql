-- ============================================================
-- 520_origin_tags (spec 010 — tags de origem do lead)
--
-- Marca cada contato com a origem por onde ele chegou (anúncio no
-- WhatsApp, site, formulário da Meta). Duas razões:
--   1. segmentação visível na inbox, sem ler o bloco de campanha;
--   2. base para escolher QUAL agente atende — a intenção do PO.
--
-- TRÊS DECISÕES QUE VALEM REGISTRO:
--
-- (a) A tag é PROJEÇÃO, nunca a verdade. A origem já é dado
--     estruturado (`lead_ingestions.source`, `deals.tracking`). Se a
--     tag for apagada, o lead continua sendo de anúncio e um
--     reprocessamento devolve a marca. O contrário — tag como fonte
--     de verdade — perderia o dado com um clique.
--
-- (b) `slug` estável + `is_system`. Rotear agente pelo NOME da tag
--     quebra em silêncio no dia em que alguém renomeia "WhatsApp
--     Anúncio" para "WhatsApp - Anúncio". O nome fica livre para
--     edição; o roteamento amarra no slug, que é imutável.
--
-- (c) A tag vive no CONTATO (é onde `contact_tags` liga), então ela
--     significa "esta PESSOA já veio por X" — histórico, não estado
--     da conversa. Isso é proposital: lead de Site e de Formulário
--     não abre conversa de WhatsApp nenhuma, e é justamente a tag no
--     contato que conta ao atendente, meses depois, que aquela
--     pessoa já pediu proposta pelo site.
--
-- DIVERGÊNCIA: aditivo em `tags` (Princípio V).
-- ============================================================

ALTER TABLE tags ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tags.slug IS
  'Identificador estável de tag do sistema (ex.: origin_ctwa). '
  'Automação e roteamento de agente amarram AQUI, não no nome — o '
  'nome é editável pelo usuário.';

-- Uma tag de cada slug por empresa. Parcial porque tag criada à mão
-- não tem slug e não deve concorrer por unicidade.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_account_slug
  ON tags (account_id, slug)
  WHERE slug IS NOT NULL;

-- ------------------------------------------------------------
-- Proteção das tags do sistema.
--
-- Via TRIGGER e não via policy de propósito: as policies de `tags`
-- foram reescritas mecanicamente pela 512 (is_account_member ->
-- is_active_member) e redeclará-las aqui arriscaria reverter aquela
-- correção de isolamento. O trigger é ortogonal ao RLS e vale para
-- qualquer caminho, inclusive service_role.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_system_tags()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION
        'A tag "%" é do sistema e não pode ser excluída (o roteamento depende dela). Renomeie se quiser outro rótulo.',
        OLD.name
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: nome e cor livres; slug e is_system, não.
  IF OLD.is_system AND (
       NEW.slug IS DISTINCT FROM OLD.slug
    OR NEW.is_system IS DISTINCT FROM OLD.is_system
    OR NEW.account_id IS DISTINCT FROM OLD.account_id
  ) THEN
    RAISE EXCEPTION
      'A identidade da tag de sistema "%" não pode ser alterada (renomear é permitido).',
      OLD.name
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_system_tags_del ON tags;
CREATE TRIGGER guard_system_tags_del BEFORE DELETE ON tags
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_tags();

DROP TRIGGER IF EXISTS guard_system_tags_upd ON tags;
CREATE TRIGGER guard_system_tags_upd BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_tags();

-- ------------------------------------------------------------
-- Criação idempotente das tags de origem de uma empresa.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_origin_tags(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  -- `tags.user_id` é NOT NULL e serve de coluna de auditoria; o dono
  -- da empresa é o mesmo critério que o webhook usa para carimbar
  -- linhas criadas por máquina.
  SELECT owner_user_id INTO v_owner FROM accounts WHERE id = p_account_id;
  IF v_owner IS NULL THEN
    RETURN;  -- empresa sem dono ainda: nada a fazer, sem erro
  END IF;

  INSERT INTO tags (account_id, user_id, name, color, slug, is_system)
  VALUES
    (p_account_id, v_owner, 'Origem: WhatsApp Anúncio', '#22c55e', 'origin_ctwa',     TRUE),
    (p_account_id, v_owner, 'Origem: Site',             '#3b82f6', 'origin_site',     TRUE),
    (p_account_id, v_owner, 'Origem: Formulário Meta',  '#a855f7', 'origin_meta_form', TRUE)
  ON CONFLICT (account_id, slug) WHERE slug IS NOT NULL DO NOTHING;
END;
$$;

ALTER FUNCTION public.ensure_origin_tags(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_origin_tags(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_origin_tags(UUID) TO service_role;

-- Todas as empresas que já existem.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM accounts LOOP
    PERFORM public.ensure_origin_tags(r.id);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- E as futuras: `provision_company` (511) passa a semear as tags.
-- Redeclarada por inteiro — a única mudança é a linha do PERFORM.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_company(
  p_name TEXT,
  p_first_user UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'provision_company: nome da empresa é obrigatório'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_first_user) THEN
    RAISE EXCEPTION
      'provision_company: usuário % não tem profile (precisa ter feito signup)',
      p_first_user
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (btrim(p_name), p_first_user)
  RETURNING id INTO v_account_id;

  INSERT INTO account_members (account_id, user_id, role)
  VALUES (v_account_id, p_first_user, 'owner')
  ON CONFLICT (account_id, user_id) DO NOTHING;

  UPDATE profiles
  SET account_id = v_account_id,
      account_role = 'owner'
  WHERE user_id = p_first_user;

  -- Empresa nova já nasce com as tags de origem (spec 010).
  PERFORM public.ensure_origin_tags(v_account_id);

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.provision_company(TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provision_company(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_company(TEXT, UUID) TO service_role;
