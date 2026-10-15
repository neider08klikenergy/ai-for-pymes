-- ============================================================
-- Migration: 20261025000000_pqrs
-- PQRS de los workspaces hacia el equipo de Falvrick (MVP).
--
-- Un miembro del workspace (casi siempre el admin) reporta una petición,
-- queja, reclamo, sugerencia o falla desde el panel, con una imagen opcional.
-- El equipo de Falvrick (super admin) las ve en Agencia → PQRS y les cambia el
-- estado. El workspace no ve su lista: el seguimiento es interno.
--
-- Se crean desde el servidor (POST /api/pqrs) con el service role, después de
-- comprobar la membresía y el límite por hora; ninguna sesión inserta directo.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pqrs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  creado_por   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('peticion', 'queja', 'reclamo', 'sugerencia', 'falla')),
  asunto       TEXT NOT NULL CHECK (char_length(asunto) BETWEEN 1 AND 150),
  descripcion  TEXT NOT NULL CHECK (char_length(descripcion) BETWEEN 1 AND 4000),
  imagen_path  TEXT,              -- ruta en el bucket privado 'pqrs'
  contexto     JSONB NOT NULL DEFAULT '{}'::jsonb, -- página, navegador, versión
  estado       TEXT NOT NULL DEFAULT 'abierta'
                 CHECK (estado IN ('abierta', 'en_progreso', 'resuelta', 'descartada')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pqrs_estado ON public.pqrs (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqrs_creador ON public.pqrs (creado_por, created_at DESC);

DROP TRIGGER IF EXISTS trg_pqrs_updated_at ON public.pqrs;
CREATE TRIGGER trg_pqrs_updated_at BEFORE UPDATE ON public.pqrs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Solo el equipo de Falvrick las ve y cambia su estado.
ALTER TABLE public.pqrs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pqrs_super_admin ON public.pqrs;
CREATE POLICY pqrs_super_admin ON public.pqrs
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

REVOKE ALL ON public.pqrs FROM anon;
GRANT SELECT, UPDATE ON public.pqrs TO authenticated;
GRANT ALL ON public.pqrs TO service_role;

-- Imágenes: bucket PRIVADO (capturas del panel de un cliente). Las sube el
-- servidor y la agencia las ve con URLs firmadas; sin políticas para sesiones.
-- Si el INSERT falla por permisos, crea el bucket en el dashboard con estos datos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pqrs', 'pqrs', false, 4194304, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- End of migration: 20261025000000_pqrs
-- ============================================================
