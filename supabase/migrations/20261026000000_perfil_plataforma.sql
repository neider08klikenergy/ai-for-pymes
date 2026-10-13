-- ============================================================
-- Migration: 20261026000000_perfil_plataforma
-- Perfil de Felrick (la startup): datos de contacto de soporte que ven los
-- workspaces en el botón Soporte del panel.
--
-- Una sola fila (id = true). La edita el equipo de Felrick (super admin) en
-- Agencia → Perfil; cualquier usuario con sesión la lee.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.perfil_plataforma (
  id               BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  soporte_email    TEXT CHECK (soporte_email IS NULL OR soporte_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  soporte_whatsapp TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(soporte_whatsapp) <= 5),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.perfil_plataforma (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_perfil_plataforma_updated_at ON public.perfil_plataforma;
CREATE TRIGGER trg_perfil_plataforma_updated_at BEFORE UPDATE ON public.perfil_plataforma
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.perfil_plataforma ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfil_plataforma_select ON public.perfil_plataforma;
CREATE POLICY perfil_plataforma_select ON public.perfil_plataforma
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS perfil_plataforma_update ON public.perfil_plataforma;
CREATE POLICY perfil_plataforma_update ON public.perfil_plataforma
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

REVOKE ALL ON public.perfil_plataforma FROM anon;
GRANT SELECT, UPDATE ON public.perfil_plataforma TO authenticated;
GRANT ALL ON public.perfil_plataforma TO service_role;

-- ============================================================
-- End of migration: 20261026000000_perfil_plataforma
-- ============================================================
