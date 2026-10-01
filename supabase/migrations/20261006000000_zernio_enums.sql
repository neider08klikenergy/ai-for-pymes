-- ============================================================
-- Migration: 20261006000000_zernio_enums
-- Zernio como proveedor de mensajería (WhatsApp + Instagram + Facebook).
--
-- ALTER TYPE ... ADD VALUE no puede usarse en la misma transacción que
-- el valor nuevo, por eso va solo en este archivo. El resto está en
-- 20261006000001_zernio.sql.
-- ============================================================

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'zernio';
ALTER TYPE public.conversation_channel ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE public.conversation_channel ADD VALUE IF NOT EXISTS 'facebook';
