-- ============================================================
-- Se retira YCloud como proveedor de WhatsApp (13 oct 2026)
--
-- La plataforma queda con Zernio y Kapso. El código ya no lee, envía ni
-- recibe por YCloud (el webhook /api/webhooks/ycloud se eliminó), así que una
-- fila de YCloud solo guardaría credenciales sin uso: se borran.
--
-- Antes de aplicar, revisar que ningún workspace dependa de ella:
--   SELECT workspace_id, enabled FROM public.integrations WHERE provider = 'ycloud';
-- Un workspace con YCloud activo queda sin WhatsApp hasta conectar Zernio o
-- Kapso en Configuración → Integraciones.
--
-- El valor 'ycloud' del enum integration_provider se deja: Postgres no quita
-- valores de un enum sin recrear el tipo, y ya no lo escribe nadie.
-- ============================================================

DELETE FROM public.integrations WHERE provider = 'ycloud';
