# Quickstart — Multi-conta

Como exercitar a fundação multi-conta em dev (projeto Supabase de dev, `sa-east-1`).

## Aplicar as migrations

```powershell
# faixa 508_+ (007 foi até 507)
supabase db push   # ou, se a porta 5432 estiver bloqueada, colar no SQL Editor
```

Ordem: `508_account_members` → `509_is_account_member_multi` →
`510_membership_rpcs` → `511_handle_new_user_no_account`.

## Provisionar a primeira empresa (papel da TI — fora do app)

Não há tela de "criar empresa" (FR-019). A TI provisiona via SQL/seed:

```sql
-- cria a empresa e vincula o primeiro usuário como owner + define ativa
SELECT provision_company('Vitalmed Salvador', '<user_uuid_da_TI>');
```

(Ou, manualmente: `INSERT INTO accounts …; INSERT INTO account_members(…, 'owner');
UPDATE profiles SET account_id = <conta>, account_role = 'owner' WHERE user_id = …`.)

## Cenário 1 — Operar duas empresas e trocar sem deslogar (US1)

1. Provisionar duas empresas (Salvador, São Luís) e dar ao mesmo usuário vínculo
   nas duas (via convite aceito, cenário 3).
2. Logar uma vez. O **seletor de empresa** mostra as duas.
3. Selecionar "São Luís" → `POST /api/account/switch`; conferir que contatos/
   conversas passam a ser os de São Luís, **sem novo login**; nenhuma tela mostra
   dado de Salvador (FR-016).
4. Reabrir o app → a última selecionada persiste (servidor, `profiles.account_id`).

## Cenário 2 — Isolamento preservado (US2)

- Com um 3º usuário membro **só** de Salvador, tentar `GET` de um recurso de São
  Luís por id/URL → **negado** pelo RLS (`is_account_member` = falso).

## Cenário 3 — Convite aditivo (US4)

1. Admin de São Luís cria um convite (fluxo existente) → link `/join/<token>`.
2. Usuário que **já** pertence a Salvador aceita → `redeem_invitation`:
   ganha vínculo com São Luís **sem perder** Salvador, e São Luís vira a ativa.
3. Seletor do usuário agora lista as duas.

## Cenário 4 — Migração sem perda (US3)

- Rodar `508_` sobre um snapshot com usuários single-account e conferir: cada
  `profiles` gerou um `account_members` equivalente (mesmo papel); `profiles.account_id`
  segue apontando a conta (agora "ativa"); acesso intacto; suíte de RLS verde.

## Cenário 5 — Sem empresa (FR-023)

- Criar um usuário novo (signup) → `handle_new_user` cria só o profile
  (`account_id = NULL`). Ao logar, vê a tela **"sem empresa"** (aguardar convite /
  TI), com logout; nenhuma área de dados acessível.

## Testes esperados

- SQL/integração: backfill idempotente; `is_account_member` multi; guarda do último
  owner; `redeem_invitation` aditivo; `set_active_account` recusa não-membro.
- Isolamento: reusar a suíte de tenancy existente — DEVE permanecer verde (SC-004).
- i18n: paridade pt-BR/en dos rótulos novos (seletor, "sem empresa", gestão de acesso).
