-- ============================================================
-- Cupos con revisión (Alejandra, 30 sep 2026)
--
-- El cupo diario de personalizados depende de la complejidad de los pedidos:
--   - hasta cupo_diario (15): el agente agenda solo
--   - entre cupo_diario y cupo_maximo (20): una persona del equipo decide
--     (el agente toma los datos y pasa la conversación)
--   - desde cupo_maximo: no hay cupo
-- El equipo puede, por día, abrir cupo extra o cerrar cupos (cupos_dia).
-- Solo cuentan los ponqués personalizados con anticipo pagado.
-- ============================================================

ALTER TABLE public.sedes
  ADD COLUMN IF NOT EXISTS cupo_maximo INTEGER CHECK (cupo_maximo IS NULL OR cupo_maximo >= 0);

COMMENT ON COLUMN public.sedes.cupo_diario IS
  'Personalizados que el agente agenda solo por día (0 = sin límite).';
COMMENT ON COLUMN public.sedes.cupo_maximo IS
  'Tope del día. Entre cupo_diario y cupo_maximo decide una persona. NULL = igual a cupo_diario.';

-- Ajustes del equipo para un día concreto.
CREATE TABLE IF NOT EXISTS public.cupos_dia (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sede_id      UUID NOT NULL REFERENCES public.sedes(id) ON DELETE CASCADE,
  fecha        DATE NOT NULL,
  -- Cupo automático de ese día (reemplaza cupo_diario). NULL = el de la sede.
  cupo         INTEGER CHECK (cupo IS NULL OR cupo >= 0),
  cerrado      BOOLEAN NOT NULL DEFAULT FALSE,
  nota         TEXT,
  updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sede_id, fecha)
);

ALTER TABLE public.cupos_dia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cupos_dia_select ON public.cupos_dia;
CREATE POLICY cupos_dia_select ON public.cupos_dia FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT auth_workspace_ids()));
-- El equipo de la tienda (no solo admin) abre y cierra cupos.
DROP POLICY IF EXISTS cupos_dia_write ON public.cupos_dia;
CREATE POLICY cupos_dia_write ON public.cupos_dia FOR ALL TO authenticated
  USING (auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[]))
  WITH CHECK (auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[]));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cupos_dia TO authenticated;
GRANT ALL ON public.cupos_dia TO service_role;

-- ------------------------------------------------------------
-- Estado del cupo de un día (lo usan el agente y el panel)
-- ------------------------------------------------------------
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
  SELECT * INTO v_ajuste FROM cupos_dia WHERE sede_id = p_sede_id AND fecha = p_fecha;

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

-- ------------------------------------------------------------
-- pd_consultar_cupo: misma firma, ahora con revisión y ajustes del día.
-- Motivos nuevos:
--   CUPOS_CERRADOS    el equipo cerró el día
--   CUPO_EN_REVISION  pasó el cupo automático: decide una persona
--   SIN_CUPO          llegó al tope del día
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_consultar_cupo(
  p_ws            UUID,
  p_sede_codigo   TEXT,
  p_fecha_entrega TEXT,
  p_cantidad      INTEGER DEFAULT 1,
  p_personalizado BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_sede   sedes%ROWTYPE;
  v_tz     TEXT := pd_zona(p_ws);
  v_fecha  TIMESTAMPTZ := pd_parse_fecha(p_ws, p_fecha_entrega);
  v_min_h  NUMERIC := pd_regla_num(p_ws, 'anticipacion_min_horas', 48);
  v_horas  NUMERIC;
  v_local  TIMESTAMP;
  v_dia    TEXT;
  v_rango  JSONB;
  v_en_horario BOOLEAN := TRUE;
  v_estado JSONB;
  v_usados INTEGER := 0;
  v_pedido INTEGER := GREATEST(COALESCE(p_cantidad, 1), 1);
  v_auto   INTEGER;
  v_max    INTEGER;
  v_motivos TEXT[] := '{}';
BEGIN
  SELECT * INTO v_sede FROM sedes
   WHERE workspace_id = p_ws AND activa AND lower(codigo) = lower(btrim(p_sede_codigo));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEDE_NO_EXISTE',
      'sedes', (SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre,
                'acepta_personalizados', acepta_personalizados))
                FROM sedes WHERE workspace_id = p_ws AND activa));
  END IF;

  IF v_fecha IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FECHA_INVALIDA',
      'formato', 'YYYY-MM-DDTHH:MM (hora local) o ISO con offset');
  END IF;

  v_local := v_fecha AT TIME ZONE v_tz;
  v_horas := round(EXTRACT(EPOCH FROM (v_fecha - now())) / 3600.0, 1);
  v_dia   := (ARRAY['domingo','lunes','martes','miercoles','jueves','viernes','sabado'])
               [EXTRACT(DOW FROM v_local)::int + 1];
  v_rango := v_sede.horarios -> v_dia;

  IF v_rango IS NOT NULL AND jsonb_array_length(v_rango) = 2 THEN
    v_en_horario := v_local::time BETWEEN (v_rango->>0)::time AND (v_rango->>1)::time;
  END IF;

  IF p_personalizado AND NOT v_sede.acepta_personalizados THEN
    v_motivos := array_append(v_motivos, 'SEDE_NO_HACE_PERSONALIZADOS');
  END IF;
  IF v_horas < 0 THEN
    v_motivos := array_append(v_motivos, 'FECHA_PASADA');
  ELSIF p_personalizado AND v_horas < v_min_h THEN
    v_motivos := array_append(v_motivos, 'NO_CUMPLE_ANTICIPACION');
  END IF;
  IF NOT v_en_horario THEN
    v_motivos := array_append(v_motivos, 'FUERA_DE_HORARIO');
  END IF;

  -- El cupo es de ponqués personalizados: los productos de vitrina no lo usan.
  IF p_personalizado THEN
    v_estado := pd_estado_cupo_dia(p_ws, v_sede.id, v_local::date);
    v_usados := (v_estado->>'usados')::int;
    v_auto   := (v_estado->>'cupo_automatico')::int;
    v_max    := (v_estado->>'cupo_maximo')::int;

    IF (v_estado->>'cerrado')::boolean THEN
      v_motivos := array_append(v_motivos, 'CUPOS_CERRADOS');
    ELSIF v_auto > 0 AND v_usados + v_pedido > v_max THEN
      v_motivos := array_append(v_motivos, 'SIN_CUPO');
    ELSIF v_auto > 0 AND v_usados + v_pedido > v_auto THEN
      v_motivos := array_append(v_motivos, 'CUPO_EN_REVISION');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'disponible', cardinality(v_motivos) = 0,
    'motivos', to_jsonb(v_motivos),
    -- Solo falta que una persona apruebe el cupo (todo lo demás está bien).
    'requiere_persona', v_motivos = ARRAY['CUPO_EN_REVISION'],
    'sede', v_sede.nombre,
    'sede_codigo', v_sede.codigo,
    'fecha_local', to_char(v_local, 'YYYY-MM-DD HH24:MI'),
    'dia', v_dia,
    'horario_sede', v_rango,
    'horas_de_anticipacion', v_horas,
    'anticipacion_minima_horas', v_min_h,
    'cupo_automatico', v_auto,
    'cupo_maximo', v_max,
    'personalizados_pagados_ese_dia', v_usados,
    'ahora_local', to_char(now() AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pd_estado_cupo_dia(UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_estado_cupo_dia(UUID, UUID, DATE) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_consultar_cupo(UUID, TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_consultar_cupo(UUID, TEXT, TEXT, INTEGER, BOOLEAN) TO authenticated, service_role;

-- ============================================================
-- End of migration: 20261007000000_cupos_revision
-- ============================================================
