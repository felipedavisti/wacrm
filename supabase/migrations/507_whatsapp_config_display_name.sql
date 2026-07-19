-- ============================================================
-- 507_whatsapp_config_display_name (spec 007 — Estágio C)
--
-- Nomes amigáveis por número. Com N números por conta, a lista de Settings,
-- o indicador na inbox e os seletores (broadcast/saída fria) precisam de um
-- rótulo legível — o phone_number_id (ID numérico da Meta) não serve.
--
--   display_phone_number  → "+55 71 8239-5099" (vem do verifyPhoneNumber da
--                            Meta; preenchido no POST /api/whatsapp/config)
--   verified_name         → nome verificado do negócio na Meta (idem)
--   label                 → rótulo livre do usuário ("Vendas", "Suporte"),
--                            editável na lista de números
--
-- Tudo nullable e aditivo — não quebra números já salvos (ficam NULL até o
-- próximo save; a UI cai no phone_number_id enquanto isso). Cadeia de exibição
-- preferida: label → verified_name → display_phone_number → phone_number_id.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS verified_name TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT;
