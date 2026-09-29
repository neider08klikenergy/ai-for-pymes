-- ============================================================
-- Saldo a favor (29 sep 2026)
-- Política de Golosita: no hay devoluciones en efectivo. Si el cliente
-- cancela a tiempo (cancelacion_dias_calendario antes de la entrega), lo que
-- pagó queda como saldo a favor por saldo_favor_meses.
--
--   saldos_favor          uno por pedido cancelado con pago
--   pd_cancelar_pedido    cancela y (si se pide) genera el saldo, en una transacción
--   pd_aplicar_saldo      usa el saldo disponible del cliente como pago de otro pedido
--   pd_saldo_cliente      saldo disponible de un cliente (contacto o teléfono)
-- ============================================================

-- El pago con saldo a favor queda registrado como un pago más del pedido.
ALTER TABLE public.pagos_pedido DROP CONSTRAINT IF EXISTS pagos_pedido_tipo_check;
ALTER TABLE public.pagos_pedido ADD CONSTRAINT pagos_pedido_tipo_check
  CHECK (tipo IN ('anticipo', 'saldo', 'total', 'saldo_favor'));

CREATE TABLE IF NOT EXISTS public.saldos_favor (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  telefono          TEXT,
  nombre_cliente    TEXT NOT NULL,
  pedido_origen_id  UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  monto_inicial     INTEGER NOT NULL CHECK (monto_inicial > 0),
  monto_disponible  INTEGER NOT NULL CHECK (monto_disponible >= 0),
  vence_at          TIMESTAMPTZ NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'disponible'
                      CHECK (estado IN ('disponible', 'agotado', 'anulado')),
  creado_por        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT saldos_favor_monto_ok CHECK (monto_disponible <= monto_inicial),
  CONSTRAINT saldos_favor_un_saldo_por_pedido UNIQUE (pedido_origen_id)
);

CREATE INDEX IF NOT EXISTS idx_saldos_favor_contacto
  ON public.saldos_favor (workspace_id, contact_id) WHERE estado = 'disponible';
CREATE INDEX IF NOT EXISTS idx_saldos_favor_telefono
  ON public.saldos_favor (workspace_id, telefono) WHERE estado = 'disponible';

-- Uso del saldo: qué pedido consumió cuánto (auditoría).
CREATE TABLE IF NOT EXISTS public.saldos_favor_usos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  saldo_id      UUID NOT NULL REFERENCES public.saldos_favor(id) ON DELETE CASCADE,
  pedido_id     UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  pago_id       UUID REFERENCES public.pagos_pedido(id) ON DELETE SET NULL,
  monto         INTEGER NOT NULL CHECK (monto > 0),
  usado_por     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Autorización común: con sesión (panel) exige rol; sin sesión es service_role.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_puede_operar(p_ws UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NULL
      OR auth_has_role(p_ws, ARRAY['admin','manager','agent']::workspace_role[]);
$$;

-- Normaliza el teléfono a solo dígitos para comparar (+57 320… = 57320…).
CREATE OR REPLACE FUNCTION public.pd_tel(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), '');
$$;

-- ------------------------------------------------------------
-- pd_saldo_cliente — saldo disponible y vigente de un cliente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_saldo_cliente(p_ws UUID, p_contact_id UUID, p_telefono TEXT)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'disponible', COALESCE(SUM(monto_disponible), 0),
    'vence_primero', MIN(vence_at),
    'saldos', COALESCE(jsonb_agg(jsonb_build_object(
                'id', id, 'monto', monto_disponible, 'vence_at', vence_at) ORDER BY vence_at), '[]'::jsonb)
  )
  FROM saldos_favor
  WHERE workspace_id = p_ws
    AND estado = 'disponible' AND monto_disponible > 0 AND vence_at > now()
    AND ((p_contact_id IS NOT NULL AND contact_id = p_contact_id)
      OR (pd_tel(p_telefono) IS NOT NULL AND pd_tel(telefono) = pd_tel(p_telefono)));
$$;

-- ------------------------------------------------------------
-- pd_cancelar_pedido — cancela y, si se pide, deja el saldo a favor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_cancelar_pedido(
  p_pedido_id     UUID,
  p_generar_saldo BOOLEAN DEFAULT TRUE,
  p_motivo        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ped      pedidos%ROWTYPE;
  v_zona     TEXT;
  v_dias     INTEGER;
  v_min      NUMERIC;
  v_meses    NUMERIC;
  v_vence    TIMESTAMPTZ;
  v_saldo_id UUID;
BEGIN
  SELECT * INTO v_ped FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_NO_ENCONTRADO');
  END IF;
  IF NOT pd_puede_operar(v_ped.workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
  END IF;
  IF v_ped.estado IN ('entregado', 'cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_SE_PUEDE_CANCELAR', 'estado', v_ped.estado);
  END IF;

  v_zona  := pd_zona(v_ped.workspace_id);
  v_min   := pd_regla_num(v_ped.workspace_id, 'cancelacion_dias_calendario', 3);
  v_meses := pd_regla_num(v_ped.workspace_id, 'saldo_favor_meses', 6);
  v_dias  := (v_ped.fecha_entrega AT TIME ZONE v_zona)::date - (now() AT TIME ZONE v_zona)::date;

  UPDATE pedidos
     SET estado = 'cancelado',
         notas = NULLIF(concat_ws(' · ', notas,
                   'Cancelado ' || to_char(now() AT TIME ZONE v_zona, 'YYYY-MM-DD HH24:MI')
                   || COALESCE(': ' || NULLIF(btrim(p_motivo), ''), '')), ''),
         updated_at = now()
   WHERE id = v_ped.id;

  IF COALESCE(p_generar_saldo, false) AND v_ped.pagado > 0 THEN
    v_vence := now() + make_interval(months => v_meses::int);
    INSERT INTO saldos_favor (
      workspace_id, contact_id, telefono, nombre_cliente, pedido_origen_id,
      monto_inicial, monto_disponible, vence_at, creado_por, notas
    ) VALUES (
      v_ped.workspace_id, v_ped.contact_id, v_ped.telefono, v_ped.nombre_cliente, v_ped.id,
      v_ped.pagado, v_ped.pagado, v_vence, auth.uid(),
      CASE WHEN v_dias < v_min THEN 'Generado fuera del plazo de cancelación' END
    )
    ON CONFLICT (pedido_origen_id) DO NOTHING
    RETURNING id INTO v_saldo_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'numero', v_ped.numero,
    'pagado', v_ped.pagado,
    'dias_antes', v_dias,
    'dentro_de_plazo', v_dias >= v_min,
    'saldo_generado', CASE WHEN v_saldo_id IS NOT NULL THEN v_ped.pagado ELSE 0 END,
    'vence_at', CASE WHEN v_saldo_id IS NOT NULL THEN v_vence END
  );
END;
$$;

-- ------------------------------------------------------------
-- pd_aplicar_saldo — paga un pedido con el saldo a favor del cliente
-- Consume primero el saldo que vence antes. Nunca paga más del saldo del pedido.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_aplicar_saldo(p_pedido_id UUID, p_monto INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ped      pedidos%ROWTYPE;
  v_objetivo INTEGER;
  v_resta    INTEGER;
  v_usar     INTEGER;
  v_aplicado INTEGER := 0;
  v_pago_id  UUID;
  s          RECORD;
BEGIN
  SELECT * INTO v_ped FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_NO_ENCONTRADO');
  END IF;
  IF NOT pd_puede_operar(v_ped.workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
  END IF;
  IF v_ped.estado IN ('entregado', 'cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_CERRADO');
  END IF;
  IF v_ped.saldo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_PAGADO');
  END IF;

  v_objetivo := LEAST(
    v_ped.saldo,
    COALESCE(NULLIF(p_monto, 0), v_ped.saldo),
    (pd_saldo_cliente(v_ped.workspace_id, v_ped.contact_id, v_ped.telefono)->>'disponible')::int
  );
  IF v_objetivo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_SALDO_A_FAVOR');
  END IF;
  v_resta := v_objetivo;

  -- El pago se crea primero para ligar los usos a él. Sin referencia: el índice
  -- único de referencias es para comprobantes de transferencia.
  INSERT INTO pagos_pedido (workspace_id, pedido_id, tipo, monto_esperado, monto_reportado,
                            estado, revisado_por, revisado_at, banco)
  VALUES (v_ped.workspace_id, v_ped.id, 'saldo_favor', v_objetivo, v_objetivo,
          'confirmado', auth.uid(), now(), 'Saldo a favor')
  RETURNING id INTO v_pago_id;

  FOR s IN
    SELECT * FROM saldos_favor
     WHERE workspace_id = v_ped.workspace_id
       AND estado = 'disponible' AND monto_disponible > 0 AND vence_at > now()
       AND ((v_ped.contact_id IS NOT NULL AND contact_id = v_ped.contact_id)
         OR (pd_tel(v_ped.telefono) IS NOT NULL AND pd_tel(telefono) = pd_tel(v_ped.telefono)))
     ORDER BY vence_at
     FOR UPDATE
  LOOP
    EXIT WHEN v_resta <= 0;
    v_usar := LEAST(s.monto_disponible, v_resta);
    UPDATE saldos_favor
       SET monto_disponible = monto_disponible - v_usar,
           estado = CASE WHEN monto_disponible - v_usar = 0 THEN 'agotado' ELSE estado END,
           updated_at = now()
     WHERE id = s.id;
    INSERT INTO saldos_favor_usos (workspace_id, saldo_id, pedido_id, pago_id, monto, usado_por)
    VALUES (v_ped.workspace_id, s.id, v_ped.id, v_pago_id, v_usar, auth.uid());
    v_resta := v_resta - v_usar;
    v_aplicado := v_aplicado + v_usar;
  END LOOP;

  -- Los saldos quedaron bloqueados (FOR UPDATE): lo aplicado es lo calculado,
  -- salvo que otra transacción los haya usado entre el cálculo y el bloqueo.
  IF v_aplicado <> v_objetivo THEN
    RAISE EXCEPTION 'SALDO_CAMBIO_EN_PARALELO';
  END IF;

  UPDATE pedidos
     SET pagado = pagado + v_aplicado,
         estado = CASE
           WHEN estado IN ('pendiente_anticipo', 'por_verificar')
                AND pagado + v_aplicado >= anticipo_requerido THEN 'confirmado'
           ELSE estado END,
         updated_at = now()
   WHERE id = v_ped.id
   RETURNING * INTO v_ped;

  RETURN jsonb_build_object('ok', true, 'numero', v_ped.numero, 'aplicado', v_aplicado,
                            'pagado', v_ped.pagado, 'saldo', v_ped.saldo, 'estado', v_ped.estado);
END;
$$;

-- ------------------------------------------------------------
-- Seguridad
-- ------------------------------------------------------------
ALTER TABLE public.saldos_favor      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saldos_favor_usos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saldos_favor_select ON public.saldos_favor;
CREATE POLICY saldos_favor_select ON public.saldos_favor FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT auth_workspace_ids()));
DROP POLICY IF EXISTS saldos_favor_usos_select ON public.saldos_favor_usos;
CREATE POLICY saldos_favor_usos_select ON public.saldos_favor_usos FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT auth_workspace_ids()));
-- Sin políticas de escritura: solo se modifican con las funciones de arriba.

REVOKE ALL ON FUNCTION public.pd_puede_operar(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_saldo_cliente(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_cancelar_pedido(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_aplicar_saldo(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_puede_operar(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_saldo_cliente(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_cancelar_pedido(UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_aplicar_saldo(UUID, INTEGER) TO authenticated, service_role;
