-- ============================================================
-- Migration: 20261027000000_suspender_workspace
-- Falvrick (super admin) suspende o reactiva un workspace, por ejemplo por
-- falta de pago. Usa workspaces.is_active (ya existía, sin uso).
--
-- Suspendido: el panel muestra un aviso genérico, los mensajes entrantes se
-- guardan sin respuesta, no sale ningún envío y no se gasta IA. Nada se
-- borra; al reactivar todo sigue donde estaba.
--
-- 1. Un admin de workspace podía editar su propia fila (workspaces_update_admins):
--    is_active ahora solo lo cambia el super admin (o el servidor).
-- 2. El motivo NO va en workspaces (el cliente lee su fila): va en
--    workspace_suspensiones, el historial que solo ve el super admin.
-- 3. cambiar_estado_workspace(): suspende/reactiva y deja el historial en una
--    sola transacción.
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_active: solo super admin o servidor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspaces_guard_is_active()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.is_active IS DISTINCT FROM OLD.is_active
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Solo el equipo de Falvrick suspende o reactiva un workspace'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspaces_guard_is_active ON public.workspaces;
CREATE TRIGGER trg_workspaces_guard_is_active
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.workspaces_guard_is_active();

-- ------------------------------------------------------------
-- 2. Historial (con el motivo), solo para el super admin
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_suspensiones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  accion       TEXT NOT NULL CHECK (accion IN ('suspender', 'reactivar')),
  motivo       TEXT CHECK (motivo IS NULL OR char_length(motivo) <= 500),
  hecho_por    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workspace_suspensiones_ws
  ON public.workspace_suspensiones (workspace_id, created_at DESC);

ALTER TABLE public.workspace_suspensiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_suspensiones_super_admin ON public.workspace_suspensiones;
CREATE POLICY workspace_suspensiones_super_admin ON public.workspace_suspensiones
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

REVOKE ALL ON public.workspace_suspensiones FROM anon, authenticated;
GRANT SELECT ON public.workspace_suspensiones TO authenticated;
GRANT ALL ON public.workspace_suspensiones TO service_role;

-- ------------------------------------------------------------
-- 3. Suspender / reactivar (super admin), con historial
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cambiar_estado_workspace(
  p_workspace_id UUID,
  p_activo       BOOLEAN,
  p_motivo       TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Solo el equipo de Falvrick suspende o reactiva un workspace'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspaces
     SET is_active = p_activo, updated_at = now()
   WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace no encontrado' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.workspace_suspensiones (workspace_id, accion, motivo, hecho_por)
  VALUES (
    p_workspace_id,
    CASE WHEN p_activo THEN 'reactivar' ELSE 'suspender' END,
    NULLIF(btrim(p_motivo), ''),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cambiar_estado_workspace(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_workspace(uuid, boolean, text) TO authenticated;

-- ============================================================
-- End of migration: 20261027000000_suspender_workspace
-- ============================================================
