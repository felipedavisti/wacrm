# Quickstart — Verificar o refactor (sem regressão)

Feature: `001-engine-send-base`. Objetivo do roteiro: provar **comportamento
idêntico** (US1) e a **costura única** (US2) depois do refactor.

## 1. Testes automatizados (portão principal)

```bash
npm run test        # toda a suíte Vitest — deve ficar 100% verde
npm run typecheck   # tsc --noEmit — sem erros de tipo
```

Cobertura que precisa existir ao final:
- `src/lib/whatsapp/engine-send-base.test.ts` (novo) cobrindo:
  - retry por variante de telefone (2ª variante funciona; telefone é corrigido);
  - filtro `account_id` (contato de outra conta → erro, sem envio);
  - falha de INSERT pós-envio → erro específico;
  - cada tipo (texto/template/mídia/botões/lista) monta a linha `messages` certa.
- Testes existentes dos motores permanecem verdes **sem alteração**.

## 2. Verificação de comportamento (manual/E2E, opcional)

Contra o ambiente de dev (Supabase cloud), com um número de WhatsApp de teste:

1. **Flow (chatbot)**: dispare um flow com nós `send_message`, `send_buttons`,
   `send_list`, `send_media`, `collect_input`, `handoff`. Confira na inbox: cada
   mensagem aparece com o tipo certo, `sender_type='bot'`, e os botões/lista
   re-renderizam (via `interactive_payload`).
2. **Automação (regras CRM)**: dispare uma automação com `send_message`,
   `send_template` e `send_buttons/list`. Mesmo resultado.
3. **Precedência**: com um flow ativo que consome a mensagem, confirme que a
   automação de conteúdo e o auto-reply de IA **não** disparam (flows > automations > IA).
4. **Auto-reply de IA**: confirme que a mensagem da IA é persistida com
   `ai_generated = true`.

## 3. Verificar a costura (US2 — prontidão para multi-número)

Inspeção de código, não runtime:
- Existe **um único** `resolveConfig` compartilhado; nenhum `.single()` de
  `whatsapp_config` espalhado nos `meta-send.ts`.
- Trocar `resolveConfigByAccount` por uma implementação por conversa tocaria
  **um** arquivo. (Não implementar aqui — só confirmar que é possível em 1 lugar.)

## 4. Critério de "pronto"

- [ ] `npm run test` verde; `npm run typecheck` limpo.
- [ ] Sem cópia duplicada da sequência de envio entre `automations` e `flows`.
- [ ] `resolveConfig` isolado num ponto.
- [ ] Sem migration, sem mudança de UI.
