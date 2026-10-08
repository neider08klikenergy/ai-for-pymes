-- ============================================================
-- Aislamiento entre workspaces (auditoría de seguridad, 8 oct 2026)
--
-- 1. Zernio: el perfil y las cuentas de un workspace (config.profile_id,
--    config.accounts, config.account_ids) eran escribibles por cualquier admin
--    de su propio workspace (PUT /integrations y la política
--    integrations_write_admins). Con los ids de otro workspace podía
--    desconectar sus canales con la key de plataforma, listar sus cuentas y
--    hacer que el webhook descartara sus eventos (dos filas = sin enrutar).
--    Esas claves solo las escribe el servidor (service role) a partir de lo que
--    dice Zernio; una sesión no puede cambiarlas, y un perfil es de un solo
--    workspace.
--
-- 2. cupos_dia: sede_id era una FK simple a sedes(id) y la política de
--    escritura solo miraba workspace_id, así que un miembro del workspace A
--    podía cerrar (o dejar sin límite) el cupo de una sede de B. El agente de B
--    leía ese ajuste con service role porque pd_estado_cupo_dia no filtraba por
--    workspace. Ahora la FK es compuesta (workspace_id, sede_id), como en
--    20260926000002_tenant_consistent_foreign_keys, y la función filtra.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Zernio: claves del servidor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integrations_guard_zernio_binding()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  k TEXT;
BEGIN
  -- service_role y las funciones del sistema pasan; solo se limitan las
  -- sesiones (PostgREST con la anon key + JWT del usuario).
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  FOREACH k IN ARRAY ARRAY['profile_id', 'accounts', 'account_ids'] LOOP
    IF TG_OP = 'INSERT' THEN
      IF NEW.config ? k THEN
        RAISE EXCEPTION 'config.% de Zernio solo lo escribe el servidor', k
          USING ERRCODE = '42501';
      END IF;
    ELSIF (NEW.config -> k) IS DISTINCT FROM (OLD.config -> k) THEN
      RAISE EXCEPTION 'config.% de Zernio solo lo escribe el servidor', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_integrations_guard_zernio_binding ON public.integrations;
CREATE TRIGGER trg_integrations_guard_zernio_binding
  BEFORE INSERT OR UPDATE ON public.integrations
  FOR EACH ROW
  WHEN (NEW.provider = 'zernio')
  EXECUTE FUNCTION public.integrations_guard_zernio_binding();

-- Un perfil de Zernio es de un solo workspace. Si una instalación ya tiene
-- perfiles repetidos, esta línea falla: revisar con
--   SELECT config->>'profile_id', array_agg(workspace_id) FROM integrations
--    WHERE provider = 'zernio' GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrations_zernio_profile
  ON public.integrations ((config ->> 'profile_id'))
  WHERE provider = 'zernio' AND COALESCE(config ->> 'profile_id', '') <> '';

-- ------------------------------------------------------------
-- 2. cupos_dia: la sede debe ser del mismo workspace
-- ------------------------------------------------------------
-- Un ajuste que apunta a la sede de otro workspace no lo pudo crear el panel
-- (solo lista sedes propias) y su dueño no lo ve ni lo puede borrar: se elimina.
DO $$
DECLARE
  n INTEGER;
BEGIN
  DELETE FROM public.cupos_dia c
   USING public.sedes s
   WHERE s.id = c.sede_id AND s.workspace_id <> c.workspace_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE WARNING 'cupos_dia: % ajuste(s) apuntaban a sedes de otro workspace y se eliminaron', n;
  END IF;
END $$;

ALTER TABLE public.cupos_dia DROP CONSTRAINT IF EXISTS cupos_dia_sede_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.cupos_dia'::regclass AND conname = 'fk_cupos_dia_sede') THEN
    ALTER TABLE public.cupos_dia
      ADD CONSTRAINT fk_cupos_dia_sede FOREIGN KEY (workspace_id, sede_id)
      REFERENCES public.sedes(workspace_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- Igual que antes, pero el ajuste del día se busca dentro del workspace.
CREATE OR REPLACE FUNCTION public.pd_estado_cupo_dia(p_ws UUID, p_sede_id UUID, p_fecha DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_sede   sedes%ROWTYPE;
  v_tz     TEXT := pd_zona(p_ws);
  v_ajuste cupos_dia%ROWTYPE;
  v_usados INTEGER;
  v_auto   INTEGER;
  v_max    INTEGER;
BEGIN
  SELECT * INTO v_sede FROM sedes WHERE id = p_sede_id AND workspace_id = p_ws;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_ajuste FROM cupos_dia
   WHERE workspace_id = p_ws AND sede_id = p_sede_id AND fecha = p_fecha;

  SELECT COALESCE(SUM(cantidad), 0) INTO v_usados FROM pedidos
   WHERE workspace_id = p_ws AND sede_id = p_sede_id
     AND lower(linea) = 'ponque_personalizado'
     AND (fecha_entrega AT TIME ZONE v_tz)::date = p_fecha
     AND estado NOT IN ('pendiente_anticipo', 'cancelado');

  v_auto := COALESCE(v_ajuste.cupo, v_sede.cupo_diario);
  -- Abrir cupo extra por encima del máximo también sube el tope de ese día.
  v_max := GREATEST(v_auto, COALESCE(v_sede.cupo_maximo, v_sede.cupo_diario));

  RETURN jsonb_build_object(
    'sede_id', v_sede.id,
    'sede', v_sede.nombre,
    'fecha', p_fecha,
    'usados', v_usados,
    'cupo_automatico', v_auto,
    'cupo_maximo', v_max,
    'cupo_sede', v_sede.cupo_diario,
    'cupo_maximo_sede', v_sede.cupo_maximo,
    'ajustado', v_ajuste.cupo IS NOT NULL,
    'cerrado', COALESCE(v_ajuste.cerrado, false),
    'nota', v_ajuste.nota,
    -- 0 = sin límite
    'sin_limite', v_auto = 0 AND NOT COALESCE(v_ajuste.cerrado, false)
  );
END;
$$;
