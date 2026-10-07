-- ============================================================
-- Migration: 20261015000000_solicitudes_demo
-- Solicitudes de demo de Felrick (nivel plataforma, no de un workspace).
--
-- Las crea la página pública /demo (un negocio que quiere conocer el
-- producto) antes de elegir la hora en Cal.com. Se guardan aunque no
-- terminen de agendar, para no perder el contacto. Las gestiona el equipo
-- de Felrick (super admin) en el panel de agencia → Solicitudes.
--
-- Cuando se conecte el webhook de Cal.com (pendiente), la reserva podrá
-- marcar la solicitud como 'agendada' y guardar la fecha de la demo.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.solicitudes_demo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  empresa       TEXT NOT NULL,
  correo        TEXT NOT NULL,
  whatsapp      TEXT NOT NULL,
  sector        TEXT,
  ciudad        TEXT,
  sedes         INTEGER CHECK (sedes IS NULL OR sedes BETWEEN 1 AND 1000),
  canales       TEXT[] NOT NULL DEFAULT '{}',
  usa_shopify   BOOLEAN,
  mensajes_dia  TEXT,             -- rango: '<20' | '20-100' | '100-500' | '>500'
  comentario    TEXT,
  estado        TEXT NOT NULL DEFAULT 'nueva' CHECK (estado IN (
                  'nueva', 'contactada', 'agendada', 'demo_hecha', 'cliente', 'descartada')),
  notas         TEXT,             -- notas internas del equipo
  demo_at       TIMESTAMPTZ,      -- fecha de la demo (a mano o por el webhook de Cal.com)
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE SET NULL, -- si se volvió cliente
  origen        TEXT NOT NULL DEFAULT 'app_demo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_demo_estado
  ON public.solicitudes_demo (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitudes_demo_correo
  ON public.solicitudes_demo (lower(correo), created_at DESC);

DROP TRIGGER IF EXISTS trg_solicitudes_demo_updated_at ON public.solicitudes_demo;
CREATE TRIGGER trg_solicitudes_demo_updated_at BEFORE UPDATE ON public.solicitudes_demo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Solo el equipo de Felrick (super admin) las ve y las gestiona. La página
-- pública inserta desde el servidor con el service role (con validación y
-- límite por correo), así que anon no tiene ningún permiso.
ALTER TABLE public.solicitudes_demo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solicitudes_demo_super_admin ON public.solicitudes_demo;
CREATE POLICY solicitudes_demo_super_admin ON public.solicitudes_demo
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

REVOKE ALL ON public.solicitudes_demo FROM anon;
GRANT SELECT, UPDATE, DELETE ON public.solicitudes_demo TO authenticated;
GRANT ALL ON public.solicitudes_demo TO service_role;

-- ============================================================
-- End of migration: 20261015000000_solicitudes_demo
-- ============================================================
