-- ============================================================
-- Excedente y anticipo al confirmar pagos (8 oct 2026)
--
-- Reglas del negocio:
--   - Paga de más: el pago se confirma siempre (no se frena al cliente). El
--     pedido queda pagado por lo que debía y el excedente queda "por decidir";
--     cualquiera del equipo elige saldo a favor (para otro pedido, vence según
--     saldo_favor_meses) o propina, al confirmar o después.
--   - Paga menos que el anticipo: el pago se registra (suma a lo pagado), pero
--     el pedido no se confirma hasta que lo pagado cubra el anticipo
--     ("sin anticipo no hay cupo").
-- Se mantienen las reglas de 20261020000000: un monto distinto al del
-- comprobante necesita motivo, y se guarda el monto original.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Excedente en el pago
-- ------------------------------------------------------------
ALTER TABLE public.pagos_pedido
  ADD COLUMN IF NOT EXISTS excedente INTEGER NOT NULL DEFAULT 0 CHECK (excedente >= 0),
  ADD COLUMN IF NOT EXISTS excedente_destino TEXT
    CHECK (excedente_destino IN ('por_decidir', 'saldo_favor', 'propina')),
  ADD COLUMN IF NOT EXISTS excedente_decidido_por UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excedente_decidido_at TIMESTAMPTZ;

COMMENT ON COLUMN public.pagos_pedido.excedente IS
  'Lo que el cliente pagó de más sobre lo que el pedido debía (no suma a pagado).';
COMMENT ON COLUMN public.pagos_pedido.excedente_destino IS
  'por_decidir · saldo_favor (se creó un saldo a favor) · propina. NULL si no hubo excedente.';

-- ------------------------------------------------------------
-- 2. Saldo a favor: también puede venir de un excedente
--    Antes: uno por pedido (cancelación). Ahora uno por pedido para las
--    cancelaciones y uno por pago para los excedentes.
-- ------------------------------------------------------------
ALTER TABLE public.saldos_favor
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'cancelacion'
    CHECK (origen IN ('cancelacion', 'excedente')),
  ADD COLUMN IF NOT EXISTS pago_origen_id UUID REFERENCES public.pagos_pedido(id) ON DELETE SET NULL;

ALTER TABLE public.saldos_favor DROP CONSTRAINT IF EXISTS saldos_favor_un_saldo_por_pedido;
CREATE UNIQUE INDEX IF NOT EXISTS uq_saldos_favor_cancelacion
  ON public.saldos_favor (pedido_origen_id) WHERE origen = 'cancelacion';
CREATE UNIQUE INDEX IF NOT EXISTS uq_saldos_favor_excedente
  ON public.saldos_favor (pago_origen_id) WHERE origen = 'excedente';

-- Igual que 20261009000000_catalogo_productos, con el ON CONFLICT del índice parcial.
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
         disponibilidad_descontada = 0,
         updated_at = now()
   WHERE id = v_ped.id;

  -- Las unidades vuelven al menú de ese día (si la fila aún cuenta unidades)
  IF v_ped.disponibilidad_descontada > 0 AND v_ped.variante_id IS NOT NULL THEN
    UPDATE disponibilidad_sede
       SET cantidad = cantidad + v_ped.disponibilidad_descontada
     WHERE variante_id = v_ped.variante_id AND sede_id = v_ped.sede_id
       AND fecha = (v_ped.fecha_entrega AT TIME ZONE v_zona)::date
       AND cantidad IS NOT NULL;
  END IF;

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
    ON CONFLICT (pedido_origen_id) WHERE origen = 'cancelacion' DO NOTHING
    RETURNING id INTO v_saldo_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'numero', v_ped.numero,
    'pagado', v_ped.pagado,
    'dias_antes', v_dias,
    'dentro_de_plazo', v_dias >= v_min,
    'saldo_generado', CASE WHEN v_saldo_id IS NOT NULL THEN v_ped.pagado ELSE 0 END,
    'vence_at', CASE WHEN v_saldo_id IS NOT NULL THEN v_vence END,
    'unidades_devueltas', v_ped.disponibilidad_descontada
  );
END;
$$;

-- Crea el saldo a favor de un excedente (lo usan las dos funciones de abajo).
CREATE OR REPLACE FUNCTION public.pd_saldo_de_excedente(p_pago_id UUID)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pago pagos_pedido%ROWTYPE;
  v_ped  pedidos%ROWTYPE;
  v_id   UUID;
BEGIN
  SELECT * INTO v_pago FROM pagos_pedido WHERE id = p_pago_id;
  IF NOT FOUND OR v_pago.excedente <= 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_ped FROM pedidos WHERE id = v_pago.pedido_id;
  INSERT INTO saldos_favor (
    workspace_id, contact_id, telefono, nombre_cliente, pedido_origen_id,
    monto_inicial, monto_disponible, vence_at, creado_por, notas, origen, pago_origen_id
  ) VALUES (
    v_ped.workspace_id, v_ped.contact_id, v_ped.telefono, v_ped.nombre_cliente, v_ped.id,
    v_pago.excedente, v_pago.excedente,
    now() + make_interval(months => pd_regla_num(v_ped.workspace_id, 'saldo_favor_meses', 6)::int),
    auth.uid(), 'Excedente de un pago del pedido ' || v_ped.numero, 'excedente', v_pago.id
  )
  ON CONFLICT (pago_origen_id) WHERE origen = 'excedente' DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- 3. pd_confirmar_pago: excedente por decidir y anticipo incompleto
--    Cambia de firma (p_excedente_destino), por eso se reemplaza.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pd_confirmar_pago(UUID, BOOLEAN, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION public.pd_confirmar_pago(
  p_pago_id           UUID,
  p_aprobar           BOOLEAN DEFAULT TRUE,
  p_monto             INTEGER DEFAULT NULL,
  p_motivo            TEXT DEFAULT NULL,
  p_excedente_destino TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pago        pagos_pedido%ROWTYPE;
  v_ped         pedidos%ROWTYPE;
  v_uid         UUID := auth.uid();
  v_monto       INTEGER;
  v_comprobante INTEGER;
  v_nota        TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_aplicado    INTEGER;
  v_excedente   INTEGER;
  v_destino     TEXT;
BEGIN
  SELECT * INTO v_pago FROM pagos_pedido WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAGO_NO_EXISTE');
  END IF;
  -- Solo miembros admin/manager/agent del workspace (service_role no tiene auth.uid)
  IF v_uid IS NOT NULL AND NOT auth_has_role(v_pago.workspace_id,
       ARRAY['admin','manager','agent']::workspace_role[]) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
  END IF;
  IF v_pago.estado <> 'por_verificar' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAGO_YA_REVISADO', 'estado', v_pago.estado);
  END IF;

  IF NOT p_aprobar THEN
    UPDATE pagos_pedido SET estado = 'rechazado', revisado_por = v_uid, revisado_at = now(),
           motivo_rechazo = p_motivo WHERE id = v_pago.id;
    -- Vuelve a "pendiente de anticipo" si el anticipo no está cubierto y no
    -- queda otro comprobante por revisar.
    UPDATE pedidos SET estado = 'pendiente_anticipo'
     WHERE id = v_pago.pedido_id AND estado = 'por_verificar'
       AND pagado < anticipo_requerido
       AND NOT EXISTS (SELECT 1 FROM pagos_pedido
                        WHERE pedido_id = v_pago.pedido_id AND estado = 'por_verificar');
    RETURN jsonb_build_object('ok', true, 'estado', 'rechazado');
  END IF;

  -- Sin el valor del domicilio el total está incompleto: primero se fija.
  IF EXISTS (SELECT 1 FROM pedidos
              WHERE id = v_pago.pedido_id AND domicilio_origen = 'pendiente') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOMICILIO_POR_DEFINIR');
  END IF;

  v_monto := COALESCE(p_monto, v_pago.monto_reportado, v_pago.monto_esperado);
  -- Lo que dice el comprobante (o, si el bot no lo leyó, lo que se esperaba).
  v_comprobante := COALESCE(v_pago.monto_reportado, v_pago.monto_esperado);

  SELECT * INTO v_ped FROM pedidos WHERE id = v_pago.pedido_id FOR UPDATE;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MONTO_NO_VALIDO');
  END IF;
  -- Un monto distinto al del comprobante necesita un motivo, que queda
  -- guardado junto con quién lo confirmó.
  IF v_monto <> v_comprobante AND v_nota IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MOTIVO_DIFERENCIA_REQUERIDO',
                              'monto_comprobante', v_comprobante);
  END IF;

  -- Al pedido solo suma lo que debía; lo demás es excedente y no frena nada.
  v_aplicado  := LEAST(v_monto, GREATEST(v_ped.total - v_ped.pagado, 0));
  v_excedente := v_monto - v_aplicado;
  v_destino   := CASE WHEN v_excedente > 0 THEN
                   CASE WHEN p_excedente_destino IN ('saldo_favor', 'propina')
                        THEN p_excedente_destino ELSE 'por_decidir' END
                 END;

  UPDATE pagos_pedido SET estado = 'confirmado', revisado_por = v_uid, revisado_at = now(),
         monto_comprobante = v_pago.monto_reportado,
         nota_revision = CASE WHEN v_monto <> v_comprobante THEN v_nota END,
         monto_reportado = v_monto,
         excedente = v_excedente,
         excedente_destino = v_destino,
         excedente_decidido_por = CASE WHEN v_destino IN ('saldo_favor', 'propina') THEN v_uid END,
         excedente_decidido_at = CASE WHEN v_destino IN ('saldo_favor', 'propina') THEN now() END
   WHERE id = v_pago.id;

  -- Sin anticipo no hay cupo: el pedido se confirma solo con el anticipo
  -- cubierto; si no, sigue pendiente (o por verificar si hay otro comprobante).
  UPDATE pedidos SET pagado = pagado + v_aplicado,
         estado = CASE
           WHEN estado NOT IN ('pendiente_anticipo', 'por_verificar') THEN estado
           WHEN pagado + v_aplicado >= anticipo_requerido THEN 'confirmado'
           WHEN EXISTS (SELECT 1 FROM pagos_pedido
                         WHERE pedido_id = v_pago.pedido_id AND estado = 'por_verificar') THEN 'por_verificar'
           ELSE 'pendiente_anticipo'
         END
   WHERE id = v_pago.pedido_id RETURNING * INTO v_ped;

  IF v_destino = 'saldo_favor' THEN
    PERFORM pd_saldo_de_excedente(v_pago.id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'estado', 'confirmado', 'numero', v_ped.numero,
    'pagado', v_ped.pagado, 'saldo', v_ped.saldo,
    'pedido_estado', v_ped.estado,
    'falta_anticipo', GREATEST(v_ped.anticipo_requerido - v_ped.pagado, 0),
    'excedente', v_excedente,
    'excedente_destino', v_destino
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. Decidir el excedente después de confirmar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_decidir_excedente(p_pago_id UUID, p_destino TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pago pagos_pedido%ROWTYPE;
BEGIN
  IF p_destino NOT IN ('saldo_favor', 'propina') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DESTINO_NO_VALIDO');
  END IF;
  SELECT * INTO v_pago FROM pagos_pedido WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAGO_NO_EXISTE');
  END IF;
  IF NOT pd_puede_operar(v_pago.workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
  END IF;
  IF v_pago.excedente <= 0 OR v_pago.excedente_destino IS DISTINCT FROM 'por_decidir' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EXCEDENTE_YA_DECIDIDO');
  END IF;

  UPDATE pagos_pedido
     SET excedente_destino = p_destino,
         excedente_decidido_por = auth.uid(),
         excedente_decidido_at = now()
   WHERE id = v_pago.id;
  IF p_destino = 'saldo_favor' THEN
    PERFORM pd_saldo_de_excedente(v_pago.id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'excedente', v_pago.excedente, 'destino', p_destino);
END;
$$;

REVOKE ALL ON FUNCTION public.pd_saldo_de_excedente(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_saldo_de_excedente(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.pd_confirmar_pago(UUID, BOOLEAN, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_confirmar_pago(UUID, BOOLEAN, INTEGER, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_decidir_excedente(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_decidir_excedente(UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Comprobantes: con anticipo parcial, lo esperado es lo que falta de él
-- ------------------------------------------------------------
-- Igual que 20261017000000_herramientas_agente, salvo el monto esperado.
CREATE OR REPLACE FUNCTION public.pd_registrar_comprobante(
  p_ws              UUID,
  p_conversation_id UUID,
  p_numero_pedido   TEXT DEFAULT NULL,
  p_monto_reportado INTEGER DEFAULT NULL,
  p_referencia      TEXT DEFAULT NULL,
  p_banco           TEXT DEFAULT NULL,
  p_fecha_pago      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_ped  pedidos%ROWTYPE;
  v_msg  RECORD;
  v_pago pagos_pedido%ROWTYPE;
  v_ref  TEXT := NULLIF(btrim(COALESCE(p_referencia, '')), '');
BEGIN
  IF p_numero_pedido IS NOT NULL AND btrim(p_numero_pedido) <> '' THEN
    -- Solo pedidos de quien escribe: esta conversación o su mismo contacto
    -- (otro canal). El número lo dice el cliente y es secuencial: sin este
    -- filtro podía cargar su comprobante al pedido de otra persona.
    SELECT * INTO v_ped FROM pedidos
     WHERE workspace_id = p_ws AND upper(numero) = upper(btrim(p_numero_pedido))
       AND (conversation_id = p_conversation_id
            OR contact_id = (SELECT contact_id FROM conversations
                              WHERE id = p_conversation_id AND workspace_id = p_ws));
  ELSE
    SELECT * INTO v_ped FROM pedidos
     WHERE workspace_id = p_ws AND conversation_id = p_conversation_id
       AND estado IN ('pendiente_anticipo', 'por_verificar')
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_NO_ENCONTRADO');
  END IF;
  IF v_ped.estado = 'cancelado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_CANCELADO', 'numero', v_ped.numero);
  END IF;

  IF v_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM pagos_pedido
     WHERE workspace_id = p_ws AND lower(referencia) = lower(v_ref) AND estado <> 'rechazado'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COMPROBANTE_DUPLICADO', 'referencia', v_ref);
  END IF;

  -- Última imagen o documento que mandó el cliente en esta conversación
  SELECT id, media, meta->>'description' AS descripcion INTO v_msg FROM messages
   WHERE workspace_id = p_ws AND conversation_id = p_conversation_id
     AND direction = 'in' AND type IN ('image', 'document')
     AND created_at > now() - interval '6 hours'
   ORDER BY created_at DESC LIMIT 1;

  INSERT INTO pagos_pedido (
    workspace_id, pedido_id, tipo, monto_esperado, monto_reportado,
    referencia, banco, fecha_pago, message_id, media, descripcion_ia
  ) VALUES (
    p_ws, v_ped.id,
    CASE WHEN v_ped.pagado < v_ped.anticipo_requerido THEN 'anticipo' ELSE 'saldo' END,
    CASE WHEN v_ped.pagado < v_ped.anticipo_requerido
         THEN v_ped.anticipo_requerido - v_ped.pagado ELSE v_ped.saldo END,
    p_monto_reportado, v_ref, p_banco, p_fecha_pago,
    v_msg.id, v_msg.media, v_msg.descripcion
  ) RETURNING * INTO v_pago;

  UPDATE pedidos SET estado = 'por_verificar'
   WHERE id = v_ped.id AND estado = 'pendiente_anticipo';

  RETURN jsonb_build_object(
    'ok', true,
    'numero', v_ped.numero,
    'monto_esperado', v_pago.monto_esperado,
    'monto_reportado', p_monto_reportado,
    'monto_coincide', p_monto_reportado IS NOT NULL AND p_monto_reportado >= v_pago.monto_esperado,
    'imagen_adjunta', v_msg.id IS NOT NULL,
    'estado', 'por_verificar',
    'nota', 'Una persona del equipo verifica el pago y confirma el pedido.'
  );
END;
$$;

-- Igual que 20261004000000_notificaciones, más el aviso de excedente.
CREATE OR REPLACE FUNCTION public.notif_pago_por_verificar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ped pedidos%ROWTYPE;
BEGIN
  IF NEW.estado <> 'por_verificar' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_ped FROM pedidos WHERE id = NEW.pedido_id;
  INSERT INTO notificaciones (workspace_id, tipo, titulo, cuerpo, enlace, conversation_id, pedido_id)
  VALUES (
    NEW.workspace_id, 'pago_por_verificar',
    'Comprobante por verificar · ' || COALESCE(v_ped.numero, 'pedido'),
    COALESCE(v_ped.nombre_cliente, 'Cliente') || ' envió un comprobante'
      || CASE WHEN NEW.monto_reportado IS NOT NULL
              THEN ' por $' || replace(to_char(NEW.monto_reportado, 'FM999,999,999'), ',', '.') ELSE '' END
      || ' (esperado $' || replace(to_char(NEW.monto_esperado, 'FM999,999,999'), ',', '.') || ')'
      || CASE WHEN NEW.monto_reportado > GREATEST(v_ped.total - v_ped.pagado, 0)
              THEN ' · pagó $' || replace(to_char(NEW.monto_reportado - GREATEST(v_ped.total - v_ped.pagado, 0),
                   'FM999,999,999'), ',', '.') || ' de más' ELSE '' END,
    '/pedidos?vista=pagos', v_ped.conversation_id, NEW.pedido_id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notif_pago_por_verificar: %', SQLERRM;
  RETURN NEW;
END;
$$;
