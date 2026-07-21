-- ============================================================
-- 511_handle_new_user_no_account (spec 008 — multi-conta)
--
-- FR-019..021: empresa é PROVISIONADA PELA TI, fora do app. O signup
-- deixa de criar um account automático: o novo usuário nasce apenas
-- com o profile (account_id NULL = estado "sem empresa", FR-023) e só
-- entra numa empresa por convite (redeem_invitation, migration 510)
-- ou por provisionamento (provision_company, abaixo).
--
-- DIVERGÊNCIA DELIBERADA do upstream (Princípio V): o upstream (e a
-- nossa 017) criavam account+profile 'owner' a cada signup.
-- ============================================================

-- 1) Signup: só o profile, sem conta.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Provisionamento pela TI (FR-019/020): cria a empresa, vincula o
--    primeiro usuário como owner e a define como conta ativa dele.
--    NÃO exposta ao app: grant apenas a service_role — rodada pela TI
--    via SQL Editor / back-office. Idempotente por (nome, usuário)?
--    Não — cada chamada cria uma empresa nova de propósito (duas
--    empresas podem ter o mesmo nome fantasia).
CREATE OR REPLACE FUNCTION public.provision_company(
  p_name TEXT,
  p_first_user UUID
) RETURNS UUID  -- o account_id criado
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

  -- Define a nova empresa como conta ativa do primeiro usuário.
  UPDATE profiles
  SET account_id = v_account_id,
      account_role = 'owner'
  WHERE user_id = p_first_user;

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.provision_company(TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provision_company(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_company(TEXT, UUID) TO service_role;
