# Contratos — RPCs de pertença e troca de conta

RPCs Postgres (SECURITY DEFINER, `search_path = public`). São a superfície sensível
de segurança (Constituição II): cada uma valida autorização antes de escrever.

## `set_active_account(target_account_id UUID) RETURNS UUID`

Troca a conta ativa do chamador. Retorna o `account_id` ativado.

- **Pré**: chamador autenticado; DEVE ser membro de `target_account_id`.
- **Efeito**: `UPDATE profiles SET account_id = target, account_role = (role em
  account_members) WHERE user_id = auth.uid()`.
- **Erros** (SQLSTATE → HTTP):
  - `42501` não autenticado → 401.
  - `42501`/`22023` não é membro do alvo → 403 (nunca ativa conta não-membro).
- **Idempotente**: ativar a conta já ativa é no-op de sucesso.
- **Grant**: `authenticated`.

## `redeem_invitation(p_token_hash TEXT) RETURNS UUID` (REESCRITA)

Aceita um convite **adicionando** um vínculo (não move mais). Retorna o `account_id`
ingressado e o define como ativo.

- **Pré**: chamador autenticado; convite válido (não usado, não expirado).
- **Efeito**:
  1. `INSERT INTO account_members(account_id, user_id, role, position)
     VALUES(inv.account_id, auth.uid(), inv.role, inv.position)
     ON CONFLICT (account_id, user_id) DO NOTHING`.
  2. Marca o convite aceito (`accepted_at`, `accepted_by_user_id`).
  3. `UPDATE profiles SET account_id = inv.account_id, account_role = inv.role`
     (entra já vendo a nova empresa).
- **NÃO** apaga conta alguma; **NÃO** recusa por dados/pertença existente
  (diferença central vs. a versão single-account).
- **Erros**: `22023` convite inválido → 400/410; `42501` não autenticado → 401.
  Já-membro → no-op (retorna o account_id).
- **Grant**: `authenticated`.

## RPCs de membro (atualização das da migration 018)

- **Conceder** (parte do fluxo de convite): admin cria o convite (fluxo existente);
  o aceite usa `redeem_invitation`. Sem adição direta nesta fase (FR-006 = convite).
- **Revogar** `remove_member(account_id, user_id)`:
  - Só `is_account_member(account_id,'admin')`.
  - **Recusa** se o alvo é o **último owner** da conta (guarda FR-005) → erro →
    409/422.
  - Efeito: `DELETE FROM account_members`. Se a conta removida era a **ativa** do
    alvo, a próxima leitura de contexto o leva a outra conta-membro ou ao estado
    "sem empresa" (FR-008).
- **Mudar papel/cargo** `set_member_role(account_id, user_id, role, position)`:
  - Só admin; **recusa** rebaixar o último owner (guarda).
  - Atualiza `account_members`; se for o próprio usuário na conta ativa, o
    `profiles.account_role` denormalizado é re-sincronizado.
