-- ============================================================
-- 510_membership_rpcs (spec 008 — multi-conta)
--
-- Reescreve as RPCs de pertença para o modelo N-para-N
-- (`account_members`, migration 508) e adiciona a troca de conta
-- ativa. Princípios:
--
--   - O ESCOPO de toda ação administrativa é a conta ATIVA do
--     chamador (profiles.account_id), e a AUTORIDADE do chamador é
--     lida de `account_members` (fonte de verdade), não do denorm.
--   - `profiles.account_role` é um denorm do papel NA conta ativa —
--     toda RPC que muda papel/pertença re-sincroniza o denorm de
--     quem tem aquela conta como ativa.
--   - FR-005: uma conta nunca fica sem owner (remoção de owner é
--     bloqueada; transferência troca 1-por-1).
--   - Convite passa a ser ADITIVO (FR-006): aceitar soma um vínculo,
--     não move nem apaga nada — a diferença central vs. a 019.
--
-- Superfície sensível (Princípio II): SECURITY DEFINER; cada função
-- valida a autoridade do chamador via auth.uid() antes de escrever.
-- DIVERGÊNCIA DELIBERADA do upstream (018/019) — Princípio V.
-- ============================================================

-- ============================================================
-- set_active_account(p_account_id) — troca de empresa (FR-011)
--
-- Valida a pertença e aponta a conta ativa do chamador, com o papel
-- denormalizado vindo do vínculo. Idempotente. Nunca ativa conta em
-- que o chamador não é membro (42501).
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_active_account(
  p_account_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role
  FROM account_members
  WHERE account_id = p_account_id AND user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET account_id = p_account_id,
      account_role = v_role
  WHERE user_id = auth.uid();

  RETURN p_account_id;
END;
$$;

ALTER FUNCTION public.set_active_account(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_active_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_account(UUID) TO authenticated;

-- ============================================================
-- redeem_invitation(p_token_hash) — aceite ADITIVO (FR-006)
--
-- Soma um vínculo em account_members (idempotente), marca o convite
-- aceito e define a empresa recém-entrada como ativa. NÃO apaga
-- conta pessoal, NÃO recusa por dados/pertença existente (as
-- recusas 23505 da 019 morrem aqui — eram o mundo 1-conta).
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- o account_id ingressado
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_role account_role_enum;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Soma o vínculo. Se já era membro, mantém o vínculo existente
  -- (papel atual vence o do convite — não rebaixa/promove por acaso).
  INSERT INTO account_members (account_id, user_id, role, position)
  VALUES (v_inv.account_id, v_caller_id, v_inv.role, v_inv.position)
  ON CONFLICT (account_id, user_id) DO NOTHING;

  -- O papel efetivo é o do vínculo (pode diferir do convite no caso
  -- já-membro) — é ele que vai para o denorm da conta ativa.
  SELECT role INTO v_role
  FROM account_members
  WHERE account_id = v_inv.account_id AND user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Entra já enxergando a nova empresa.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_role
  WHERE user_id = v_caller_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- ============================================================
-- set_member_role(p_user_id, p_new_role) — papel por vínculo
--
-- Escopo: conta ATIVA do chamador. Autoridade: papel do chamador em
-- account_members (admin+). Mudanças de owner continuam exclusivas
-- da transferência. Re-sincroniza o denorm do alvo se a conta for a
-- ativa dele.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE account_members
  SET role = p_new_role
  WHERE account_id = v_account_id AND user_id = p_user_id;

  -- Denorm: só se ESTA conta for a ativa do alvo.
  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id AND account_id = v_account_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO authenticated;

-- ============================================================
-- set_member_position(p_user_id, p_position) — cargo de vendas
--
-- Novo (FR-022): atribui/limpa o cargo (sdr/closer/vendedor) do
-- vínculo na conta ativa do chamador. Ortogonal ao papel de
-- permissão. Admin+.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_position(
  p_user_id UUID,
  p_position TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_caller_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_position IS NOT NULL
     AND p_position NOT IN ('sdr', 'closer', 'vendedor') THEN
    RAISE EXCEPTION 'Invalid position' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  UPDATE account_members
  SET position = p_position
  WHERE account_id = v_account_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_position(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_position(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_position(UUID, TEXT) TO authenticated;

-- ============================================================
-- remove_account_member(p_user_id) — revogação (FR-007/008)
--
-- Remove o VÍNCULO da conta ativa do chamador. Não cria mais "conta
-- pessoal" para o removido (mundo 1-conta, 018): ele simplesmente
-- perde esta empresa e fica com as demais (ou "sem empresa").
-- Owner não pode ser removido (FR-005 — nunca órfã). Se a conta
-- removida era a ATIVA do alvo, o ponteiro é reapontado na hora
-- para o vínculo mais antigo restante (ou NULL) — FR-008.
--
-- RETURNS UUID por compatibilidade de assinatura com a 018 (a rota
-- existente lê o retorno); agora retorna sempre NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
  v_fallback_account UUID;
  v_fallback_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or switch account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM account_members
  WHERE account_id = v_account_id AND user_id = p_user_id;

  -- FR-008: se esta era a conta ativa do removido, reaponta já —
  -- para o vínculo mais antigo restante, ou "sem empresa".
  SELECT account_id, role
  INTO v_fallback_account, v_fallback_role
  FROM account_members
  WHERE user_id = p_user_id
  ORDER BY created_at ASC
  LIMIT 1;

  UPDATE profiles
  SET account_id = v_fallback_account,   -- NULL quando não há mais vínculos
      account_role = v_fallback_role
  WHERE user_id = p_user_id AND account_id = v_account_id;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

-- ============================================================
-- transfer_account_ownership(p_new_owner_user_id)
--
-- Escopo: conta ativa. Troca owner↔admin nos VÍNCULOS (1-por-1 —
-- a conta nunca fica sem owner, FR-005), atualiza o dono de
-- referência e re-sincroniza denorms de quem tem a conta ativa.
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_caller_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE account_id = v_account_id AND user_id = p_new_owner_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Troca 1-por-1 na mesma transação: nunca zero owners.
  UPDATE account_members SET role = 'admin'
  WHERE account_id = v_account_id AND user_id = auth.uid();

  UPDATE account_members SET role = 'owner'
  WHERE account_id = v_account_id AND user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_account_id;

  -- Denorms (só de quem tem ESTA conta como ativa).
  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid() AND account_id = v_account_id;

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id AND account_id = v_account_id;
END;
$$;

ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;
