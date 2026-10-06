-- ============================================================
-- Migration: 20261011000000_shopify_enum
-- Shopify como integración por workspace (importar el catálogo).
--
-- ALTER TYPE ... ADD VALUE no puede usarse en la misma transacción que
-- el valor nuevo, por eso va solo en este archivo. El resto está en
-- 20261011000001_shopify_catalogo.sql.
-- ============================================================

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'shopify';
