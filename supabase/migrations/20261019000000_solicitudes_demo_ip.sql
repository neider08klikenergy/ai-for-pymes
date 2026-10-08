-- ============================================================
-- Límite por conexión en la demo pública (auditoría de seguridad, 8 oct 2026)
--
-- /demo solo limitaba por correo: cambiando el correo se podían insertar
-- solicitudes sin fin. Ahora cada solicitud guarda un hash de la IP de origen
-- (HMAC con una clave del servidor, nunca la IP en claro) y crearSolicitudDemo
-- limita por IP y en total por hora.
-- ============================================================

ALTER TABLE public.solicitudes_demo ADD COLUMN IF NOT EXISTS ip_hash TEXT;

COMMENT ON COLUMN public.solicitudes_demo.ip_hash IS
  'HMAC de la IP de origen (no la IP): solo para limitar solicitudes por conexión.';

CREATE INDEX IF NOT EXISTS idx_solicitudes_demo_ip
  ON public.solicitudes_demo (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitudes_demo_created
  ON public.solicitudes_demo (created_at DESC);
