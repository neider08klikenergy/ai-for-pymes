-- ============================================================
-- Correos de notificación al equipo del negocio (2 oct 2026)
--
-- Los avisos de la campana (tabla notificaciones) también pueden llegar por
-- correo. Cada usuario decide, por workspace, si los recibe y de qué tipos
-- (por defecto NO recibe nada: lo activa él mismo en Settings → Equipo).
--
-- El cron de cada minuto (/api/cron/buffer-flush) toma las notificaciones
-- pendientes con claim_notificaciones_correo(), envía a quien corresponda y
-- deja cada envío en correos_enviados.
-- ============================================================

-- ------------------------------------------------------------
-- Preferencias por usuario y workspace
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preferencias_correo (
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  activo       BOOLEAN NOT NULL DEFAULT FALSE,
  tipos        TEXT[] NOT NULL DEFAULT ARRAY['handoff', 'cliente_esperando', 'pedido_nuevo', 'pago_por_verificar'],
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id),
  CONSTRAINT preferencias_correo_tipos_validos CHECK (
    tipos <@ ARRAY['handoff', 'cliente_esperando', 'ia_retomo', 'pedido_nuevo', 'pago_por_verificar']
  )
);

ALTER TABLE public.preferencias_correo ENABLE ROW LEVEL SECURITY;

-- Cada persona ve y cambia solo las suyas, en workspaces donde es miembro.
DROP POLICY IF EXISTS preferencias_correo_propias ON public.preferencias_correo;
CREATE POLICY preferencias_correo_propias ON public.preferencias_correo FOR ALL TO authenticated
  USING (user_id = auth.uid() AND workspace_id IN (SELECT auth_workspace_ids()))
  WITH CHECK (user_id = auth.uid() AND workspace_id IN (SELECT auth_workspace_ids()));

-- ------------------------------------------------------------
-- Estado del correo de cada notificación
--   NULL         = pendiente
--   'procesando' = tomada por un cron
--   'enviado' | 'sin_destinatarios' | 'error' | 'omitido'
-- ------------------------------------------------------------
ALTER TABLE public.notificaciones
  ADD COLUMN IF NOT EXISTS correo_estado TEXT,
  ADD COLUMN IF NOT EXISTS correo_procesado_at TIMESTAMPTZ;

ALTER TABLE public.notificaciones DROP CONSTRAINT IF EXISTS notificaciones_correo_estado_check;
ALTER TABLE public.notificaciones ADD CONSTRAINT notificaciones_correo_estado_check
  CHECK (correo_estado IS NULL OR correo_estado IN
    ('procesando', 'enviado', 'sin_destinatarios', 'error', 'omitido'));

-- Lo que ya existía antes de esta migración no se envía (sería un aluvión de
-- avisos viejos el día que se activa).
UPDATE public.notificaciones
   SET correo_estado = 'omitido', correo_procesado_at = NOW()
 WHERE correo_estado IS NULL;

CREATE INDEX IF NOT EXISTS idx_notificaciones_correo_pendiente
  ON public.notificaciones (created_at)
  WHERE correo_estado IS NULL OR correo_estado = 'procesando';

-- ------------------------------------------------------------
-- Registro de envíos (uno por notificación y usuario)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.correos_enviados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notificacion_id UUID REFERENCES public.notificaciones(id) ON DELETE SET NULL,
  plantilla       TEXT NOT NULL,
  destinatario    TEXT NOT NULL,
  asunto          TEXT NOT NULL,
  estado          TEXT NOT NULL CHECK (estado IN ('enviado', 'error')),
  proveedor       TEXT NOT NULL,
  proveedor_id    TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una notificación llega una sola vez a cada persona, aunque dos crons choquen.
CREATE UNIQUE INDEX IF NOT EXISTS uq_correos_notificacion_usuario
  ON public.correos_enviados (notificacion_id, user_id)
  WHERE notificacion_id IS NOT NULL AND estado = 'enviado';

CREATE INDEX IF NOT EXISTS idx_correos_enviados_ws_fecha
  ON public.correos_enviados (workspace_id, created_at DESC);

ALTER TABLE public.correos_enviados ENABLE ROW LEVEL SECURITY;

-- Cada persona ve los correos que le llegaron. Escribe solo el servidor.
DROP POLICY IF EXISTS correos_enviados_propios ON public.correos_enviados;
CREATE POLICY correos_enviados_propios ON public.correos_enviados FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND workspace_id IN (SELECT auth_workspace_ids()));

-- ------------------------------------------------------------
-- Tomar notificaciones pendientes (sin que dos crons tomen la misma)
-- Recupera las que quedaron 'procesando' más de 10 min (un cron que murió).
-- Las de más de p_max_edad no se envían: un aviso viejo ya no sirve.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_notificaciones_correo(
  p_limite   INT DEFAULT 25,
  p_max_edad INTERVAL DEFAULT INTERVAL '2 hours'
)
RETURNS SETOF public.notificaciones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE notificaciones
     SET correo_estado = 'omitido', correo_procesado_at = NOW()
   WHERE correo_estado IS NULL
     AND created_at < NOW() - p_max_edad;

  RETURN QUERY
  UPDATE notificaciones n
     SET correo_estado = 'procesando', correo_procesado_at = NOW()
   WHERE n.id IN (
     SELECT id FROM notificaciones
      WHERE (correo_estado IS NULL
             OR (correo_estado = 'procesando' AND correo_procesado_at < NOW() - INTERVAL '10 minutes'))
        AND created_at >= NOW() - p_max_edad
      ORDER BY created_at
      LIMIT GREATEST(1, LEAST(p_limite, 100))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING n.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notificaciones_correo(INT, INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notificaciones_correo(INT, INTERVAL) TO service_role;
