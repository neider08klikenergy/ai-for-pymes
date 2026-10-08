-- ============================================================
-- Invitaciones al equipo (auditoría de seguridad, 8 oct 2026)
--
-- Antes, un manager que escribía el correo de una cuenta que ya existía en la
-- plataforma la agregaba a su workspace al instante, sin que esa persona lo
-- supiera (y el workspace aparecía en su panel). Ahora, si la cuenta ya existe
-- y no es miembro activo, se crea una invitación pendiente: la persona la ve
-- al iniciar sesión y entra solo si la acepta. Vence a los 7 días.
--
-- Los correos sin cuenta siguen igual: se crea la cuenta con una contraseña
-- provisional que el manager comparte (la cuenta nace para ese equipo).
--
-- Escrituras: el manager crea y cancela desde /api/workspace/[id]/team (service
-- role, con el tope de rol de esa ruta); el invitado responde con
-- responder_invitacion(). Una sesión no escribe la tabla directamente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invitaciones_equipo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role          workspace_role NOT NULL,
  invitado_por  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'aceptada', 'rechazada', 'cancelada')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vence_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  respondida_at TIMESTAMPTZ
);

-- Una sola invitación pendiente por persona y workspace (reinvitar la renueva).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitaciones_equipo_pendiente
  ON public.invitaciones_equipo (workspace_id, user_id) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_invitaciones_equipo_user
  ON public.invitaciones_equipo (user_id, estado);

ALTER TABLE public.invitaciones_equipo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitaciones_equipo_select ON public.invitaciones_equipo;
CREATE POLICY invitaciones_equipo_select ON public.invitaciones_equipo
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR auth_has_role(workspace_id, ARRAY['admin','manager']::workspace_role[])
  );
REVOKE ALL ON public.invitaciones_equipo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invitaciones_equipo TO authenticated;
GRANT ALL ON public.invitaciones_equipo TO service_role;

-- ------------------------------------------------------------
-- Invitaciones pendientes de quien inició sesión (con el nombre del
-- workspace, que todavía no puede leer porque no es miembro).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mis_invitaciones()
RETURNS TABLE (id UUID, workspace_id UUID, workspace_nombre TEXT, role workspace_role, vence_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.workspace_id, w.name, i.role, i.vence_at
    FROM invitaciones_equipo i
    JOIN workspaces w ON w.id = i.workspace_id AND w.is_active
   WHERE i.user_id = auth.uid()
     AND i.estado = 'pendiente'
     AND i.vence_at > NOW()
   ORDER BY i.created_at;
$$;

-- ------------------------------------------------------------
-- El invitado acepta o rechaza. Solo su propia invitación, pendiente y vigente.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.responder_invitacion(p_id UUID, p_aceptar BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv invitaciones_equipo%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
  END IF;
  SELECT * INTO v_inv FROM invitaciones_equipo
   WHERE id = p_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVITACION_NO_EXISTE');
  END IF;
  IF v_inv.estado <> 'pendiente' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVITACION_YA_RESPONDIDA');
  END IF;
  IF v_inv.vence_at <= NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVITACION_VENCIDA');
  END IF;

  IF p_aceptar THEN
    INSERT INTO memberships (workspace_id, user_id, role, is_active)
    VALUES (v_inv.workspace_id, v_uid, v_inv.role, TRUE)
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, is_active = TRUE, updated_at = NOW();
  END IF;

  UPDATE invitaciones_equipo
     SET estado = CASE WHEN p_aceptar THEN 'aceptada' ELSE 'rechazada' END,
         respondida_at = NOW()
   WHERE id = v_inv.id;

  RETURN jsonb_build_object('ok', true, 'aceptada', p_aceptar,
                            'workspace_id', v_inv.workspace_id);
END;
$$;

REVOKE ALL ON FUNCTION public.mis_invitaciones() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.responder_invitacion(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_invitaciones() TO authenticated;
GRANT EXECUTE ON FUNCTION public.responder_invitacion(UUID, BOOLEAN) TO authenticated;
