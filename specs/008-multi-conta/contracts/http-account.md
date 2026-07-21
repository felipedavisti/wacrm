# Contratos — HTTP (contexto de conta e seletor de empresa)

Rotas Next.js (App Router). Todas exigem sessão; usam o cliente SSR (RLS escopado
ao usuário). Erros seguem `toErrorResponse()` (401/403/500).

## `GET /api/account/memberships`

Lista as empresas do usuário — insumo do seletor (FR-010). Mostra **somente** as
contas em que ele é membro.

- **Resposta 200**:
  ```json
  {
    "active_account_id": "uuid | null",
    "memberships": [
      { "account_id": "uuid", "account_name": "Vitalmed Salvador",
        "role": "admin", "position": "closer" }
    ]
  }
  ```
- `active_account_id = null` → estado "sem empresa" (FR-023); `memberships` pode ser
  vazio.
- Deriva de `account_members` (join `accounts` para o nome) — RLS já restringe às
  contas-membro.

## `POST /api/account/switch`

Troca a conta ativa (FR-011).

- **Body**: `{ "account_id": "uuid" }`.
- **Efeito**: chama a RPC `set_active_account(account_id)`.
- **Resposta 200**: `{ "active_account_id": "uuid" }`.
- **403** se o usuário não é membro do alvo (a RPC recusa) — nunca troca para
  conta não-membro.
- **Cliente** (FR-016): ao receber 200, **invalida todo o cache** de dados
  escopados por conta (chave do React Query inclui a conta ativa) e refaz as
  queries, de modo que nenhuma tela mostre resíduo da conta anterior.

## Comportamento do seletor (produto)

- Renderiza a lista de `GET /memberships`; oculto/somente-leitura se houver **uma**
  empresa (FR-013).
- Sem nenhuma empresa → app roteia para a tela **"sem empresa"** (FR-023): mensagem
  para aguardar convite/procurar a TI, com **logout**; nenhuma área de dados
  acessível.
- Não há ação de **criar empresa** em lugar nenhum da UI (FR-019).

## Fora deste contrato (inalterado)

- Rotas de convite existentes (`/join/<token>`, criação de convite pelo admin)
  seguem, com o **aceite** agora aditivo (`redeem_invitation` reescrita).
- `getCurrentAccount()`/`requireRole()` (server) inalterados — continuam lendo a
  conta ativa de `profiles.account_id`.
