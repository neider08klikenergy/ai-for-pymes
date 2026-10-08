-- ============================================================
-- Herramientas del agente de WhatsApp (auditoría de seguridad, 8 oct 2026)
--
-- El cliente que escribe por WhatsApp influye en los argumentos que el modelo
-- pasa a las herramientas, así que lo que decide a quién o cuánto se cobra lo
-- fija el servidor o una persona del equipo, no el modelo:
--
-- 1. pd_registrar_comprobante: con número de pedido buscaba en todo el
--    workspace. Los números son secuenciales (GOL-00042), así que un cliente
--    podía cargar su comprobante al pedido de otra persona (y ver su monto).
--    Ahora el pedido tiene que ser de esta conversación o del mismo contacto.
--
-- 2. Domicilio sin tarifa: antes el modelo pasaba p_valor_domicilio y quedaba
--    como "valor del equipo". Ahora el pedido se registra con el domicilio
--    "por definir" (domicilio_origen = 'pendiente', valor 0), el aviso al
--    equipo lo dice, una persona lo fija en el panel (pd_fijar_domicilio) y
--    hasta entonces no se puede confirmar el pago (DOMICILIO_POR_DEFINIR).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Comprobantes: solo pedidos de quien escribe
-- ------------------------------------------------------------
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
    CASE WHEN v_ped.pagado = 0 THEN 'anticipo' ELSE 'saldo' END,
    CASE WHEN v_ped.pagado = 0 THEN v_ped.anticipo_requerido ELSE v_ped.saldo END,
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

-- ------------------------------------------------------------
-- 2. Domicilio por definir
-- ------------------------------------------------------------
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_domicilio_origen_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_domicilio_origen_check
  CHECK (domicilio_origen IN ('tarifa', 'persona', 'pendiente'));

COMMENT ON COLUMN public.pedidos.domicilio_origen IS
  'tarifa = según la tarifa de la sede; persona = lo fijó alguien del equipo en el panel; pendiente = sin tarifa, falta que el equipo lo fije.';

-- Igual que 20261009000000_catalogo_productos, salvo el domicilio sin tarifa.
CREATE OR REPLACE FUNCTION public.pd_registrar_pedido(
  p_ws              UUID,
  p_conversation_id UUID,
  p_contact_id      UUID,
  p_sede_codigo     TEXT,
  p_linea           TEXT,
  p_sabor           TEXT,
  p_tamano          TEXT,
  p_cantidad        INTEGER,
  p_fecha_entrega   TEXT,
  p_nombre_cliente  TEXT,
  p_telefono        TEXT DEFAULT NULL,
  p_modalidad       TEXT DEFAULT 'recogida',
  p_direccion       TEXT DEFAULT NULL,
  p_detalle         JSONB DEFAULT '{}'::jsonb,
  p_valor_domicilio INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_cot      JSONB;
  v_cupo     JSONB;
  v_dom      JSONB;
  v_sede     sedes%ROWTYPE;
  v_fecha    TIMESTAMPTZ := pd_parse_fecha(p_ws, p_fecha_entrega);
  v_prefijo  TEXT;
  v_existe   pedidos%ROWTYPE;
  v_ped      pedidos%ROWTYPE;
  v_tel      TEXT := p_telefono;
  v_modal    TEXT := COALESCE(NULLIF(btrim(p_modalidad), ''), 'recogida');
  v_valor_dom INTEGER := 0;
  v_origen   TEXT;
  v_variante UUID;
  v_modo     TEXT;
  v_disp     disponibilidad_sede%ROWTYPE;
  v_descuento INTEGER := 0;
BEGIN
  IF btrim(COALESCE(p_nombre_cliente, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FALTA_NOMBRE_CLIENTE');
  END IF;
  IF v_modal NOT IN ('recogida', 'domicilio') THEN
    v_modal := 'recogida';
  END IF;
  IF v_modal = 'domicilio' AND btrim(COALESCE(p_direccion, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FALTA_DIRECCION_DOMICILIO');
  END IF;

  v_cot := pd_cotizar(p_ws, p_linea, p_sabor, p_tamano, p_cantidad);
  IF NOT (v_cot->>'ok')::boolean THEN
    RETURN v_cot;
  END IF;
  v_variante := (v_cot->>'variante_id')::uuid;
  v_modo     := v_cot->>'modo_disponibilidad';

  v_cupo := pd_consultar_cupo(p_ws, p_sede_codigo, p_fecha_entrega, p_cantidad,
                              v_modo = 'bajo_pedido');
  IF NOT (v_cupo->>'ok')::boolean THEN
    RETURN v_cupo;
  END IF;
  IF NOT (v_cupo->>'disponible')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_DISPONIBLE',
                              'motivos', v_cupo->'motivos', 'detalle', v_cupo);
  END IF;

  SELECT * INTO v_sede FROM sedes
   WHERE workspace_id = p_ws AND lower(codigo) = lower(btrim(p_sede_codigo));

  -- Domicilio: la tarifa configurada manda. Sin tarifa el pedido queda con el
  -- domicilio "por definir" (0 por ahora) y lo fija una persona del equipo en
  -- el panel (pd_fijar_domicilio). p_valor_domicilio ya no se usa: lo elegía el
  -- modelo, que el cliente puede influir, y quedaba como "valor del equipo".
  IF v_modal = 'domicilio' THEN
    v_dom := pd_cotizar_domicilio(p_ws, p_sede_codigo, p_direccion);
    IF NOT (v_dom->>'ok')::boolean THEN
      RETURN v_dom;
    ELSIF v_dom->>'valor' IS NOT NULL THEN
      v_valor_dom := (v_dom->>'valor')::int;
      v_origen := 'tarifa';
    ELSE
      v_origen := 'pendiente';
    END IF;
  END IF;

  -- Teléfono por defecto: el del contacto de WhatsApp
  IF v_tel IS NULL AND p_contact_id IS NOT NULL THEN
    SELECT phone INTO v_tel FROM contacts WHERE id = p_contact_id AND workspace_id = p_ws;
  END IF;

  -- Idempotencia: si el agente llama dos veces, devolver el mismo pedido
  SELECT * INTO v_existe FROM pedidos
   WHERE workspace_id = p_ws
     AND conversation_id IS NOT DISTINCT FROM p_conversation_id
     AND estado = 'pendiente_anticipo'
     AND sede_id = v_sede.id
     AND lower(sabor) = lower(v_cot->>'sabor') AND lower(tamano) = lower(v_cot->>'tamano')
     AND fecha_entrega = v_fecha
     AND created_at > now() - interval '2 hours'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    v_ped := v_existe;
  ELSE
    -- Menú del día: la fila se bloquea para que dos pedidos simultáneos no
    -- vendan la misma unidad.
    IF v_modo IN ('por_dia', 'siempre') THEN
      SELECT * INTO v_disp FROM disponibilidad_sede
       WHERE variante_id = v_variante AND sede_id = v_sede.id
         AND fecha = (v_fecha AT TIME ZONE pd_zona(p_ws))::date
       FOR UPDATE;
      IF NOT FOUND AND v_modo = 'por_dia' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'NO_DISPONIBLE',
                                  'motivos', jsonb_build_array('MENU_SIN_CARGAR'));
      END IF;
    END IF;
    IF v_disp.id IS NOT NULL THEN
      IF NOT v_disp.disponible OR COALESCE(v_disp.cantidad, (v_cot->>'cantidad')::int) < (v_cot->>'cantidad')::int THEN
        RETURN jsonb_build_object('ok', false, 'error', 'NO_DISPONIBLE',
                                  'motivos', jsonb_build_array('AGOTADO'),
                                  'cantidad_disponible', CASE WHEN v_disp.disponible THEN v_disp.cantidad ELSE 0 END);
      END IF;
      IF v_disp.cantidad IS NOT NULL THEN
        v_descuento := (v_cot->>'cantidad')::int;
        UPDATE disponibilidad_sede SET cantidad = cantidad - v_descuento WHERE id = v_disp.id;
      END IF;
    END IF;

    v_prefijo := COALESCE((SELECT valor #>> '{}' FROM reglas_negocio
                            WHERE workspace_id = p_ws AND clave = 'prefijo_pedido'), 'PED');

    INSERT INTO pedidos (
      workspace_id, numero, contact_id, conversation_id, sede_id,
      nombre_cliente, telefono, linea, sabor, tamano, cantidad, detalle,
      modalidad, direccion_entrega, fecha_entrega,
      precio_unitario, total, anticipo_requerido, precio_validado,
      valor_domicilio, domicilio_origen, variante_id, disponibilidad_descontada
    ) VALUES (
      p_ws, v_prefijo || '-' || lpad(nextval('pedidos_numero_seq')::text, 5, '0'),
      p_contact_id, p_conversation_id, v_sede.id,
      btrim(p_nombre_cliente), v_tel, v_cot->>'linea', v_cot->>'sabor', v_cot->>'tamano',
      (v_cot->>'cantidad')::int, COALESCE(p_detalle, '{}'::jsonb),
      v_modal, CASE WHEN v_modal = 'domicilio' THEN p_direccion END, v_fecha,
      (v_cot->>'precio_unitario')::int,
      (v_cot->>'total')::int + v_valor_dom,
      (v_cot->>'anticipo')::int,
      (v_cot->>'precio_validado')::boolean,
      v_valor_dom, v_origen, v_variante, v_descuento
    ) RETURNING * INTO v_ped;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicado', v_existe.id IS NOT NULL,
    'numero', v_ped.numero,
    'sede', v_sede.nombre,
    'fecha_entrega_local', v_cupo->>'fecha_local',
    'producto', v_ped.sabor || ' ' || v_ped.tamano,
    'cantidad', v_ped.cantidad,
    'modalidad', v_ped.modalidad,
    'subtotal_producto', v_ped.total - v_ped.valor_domicilio,
    'valor_domicilio', v_ped.valor_domicilio,
    'domicilio_por_definir', v_ped.domicilio_origen = 'pendiente',
    'total', v_ped.total,
    'formas_de_pago', jsonb_build_object(
      'todo', v_ped.total,
      'solo_producto', CASE WHEN v_ped.valor_domicilio > 0
                            THEN v_ped.total - v_ped.valor_domicilio END,
      'anticipo_minimo', v_ped.anticipo_requerido
    ),
    'saldo_si_paga_anticipo', v_ped.total - v_ped.anticipo_requerido,
    'estado', v_ped.estado,
    'datos_pago', pd_datos_pago(p_ws, v_sede.id),
    'precio_validado', v_ped.precio_validado
  );
END;
$$;

-- El equipo fija (o corrige) el valor del domicilio de un pedido.
CREATE OR REPLACE FUNCTION public.pd_fijar_domicilio(
  p_pedido_id UUID,
  p_valor     INTEGER
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ped pedidos%ROWTYPE;
  v_uid UUID := auth.uid();
BEGIN
  IF p_valor IS NULL OR p_valor < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VALOR_NO_VALIDO');
  END IF;
  SELECT * INTO v_ped FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_NO_ENCONTRADO');
  END IF;
  -- Solo miembros admin/manager/agent del workspace (service_role no tiene auth.uid)
  IF v_uid IS NOT NULL AND NOT auth_has_role(v_ped.workspace_id,
       ARRAY['admin','manager','agent']::workspace_role[]) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
  END IF;
  IF v_ped.modalidad <> 'domicilio' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ES_DOMICILIO');
  END IF;
  IF v_ped.estado IN ('entregado', 'cancelado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PEDIDO_CERRADO', 'estado', v_ped.estado);
  END IF;

  UPDATE pedidos
     SET total = total - valor_domicilio + p_valor,
         valor_domicilio = p_valor,
         domicilio_origen = 'persona'
   WHERE id = v_ped.id
  RETURNING * INTO v_ped;

  RETURN jsonb_build_object('ok', true, 'numero', v_ped.numero,
                            'valor_domicilio', v_ped.valor_domicilio,
                            'total', v_ped.total, 'saldo', v_ped.saldo);
END;
$$;

REVOKE ALL ON FUNCTION public.pd_fijar_domicilio(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_fijar_domicilio(UUID, INTEGER) TO authenticated, service_role;

-- No se confirma un pago mientras el domicilio esté por definir.
CREATE OR REPLACE FUNCTION public.pd_confirmar_pago(
  p_pago_id  UUID,
  p_aprobar  BOOLEAN DEFAULT TRUE,
  p_monto    INTEGER DEFAULT NULL,
  p_motivo   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pago pagos_pedido%ROWTYPE;
  v_ped  pedidos%ROWTYPE;
  v_uid  UUID := auth.uid();
  v_monto INTEGER;
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
    UPDATE pedidos SET estado = 'pendiente_anticipo'
     WHERE id = v_pago.pedido_id AND estado = 'por_verificar' AND pagado = 0;
    RETURN jsonb_build_object('ok', true, 'estado', 'rechazado');
  END IF;

  -- Sin el valor del domicilio el total está incompleto: primero se fija.
  IF EXISTS (SELECT 1 FROM pedidos
              WHERE id = v_pago.pedido_id AND domicilio_origen = 'pendiente') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOMICILIO_POR_DEFINIR');
  END IF;

  v_monto := COALESCE(p_monto, v_pago.monto_reportado, v_pago.monto_esperado);
  UPDATE pagos_pedido SET estado = 'confirmado', revisado_por = v_uid, revisado_at = now(),
         monto_reportado = v_monto WHERE id = v_pago.id;
  UPDATE pedidos SET pagado = pagado + v_monto,
         estado = CASE WHEN estado IN ('pendiente_anticipo', 'por_verificar') THEN 'confirmado' ELSE estado END
   WHERE id = v_pago.pedido_id RETURNING * INTO v_ped;

  RETURN jsonb_build_object('ok', true, 'estado', 'confirmado', 'numero', v_ped.numero,
                            'pagado', v_ped.pagado, 'saldo', v_ped.saldo);
END;
$$;

-- El aviso de pedido nuevo dice si falta fijar el domicilio.
CREATE OR REPLACE FUNCTION public.notif_pedido_nuevo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zona TEXT := pd_zona(NEW.workspace_id);
BEGIN
  INSERT INTO notificaciones (workspace_id, tipo, titulo, cuerpo, enlace, conversation_id, pedido_id)
  VALUES (
    NEW.workspace_id, 'pedido_nuevo',
    'Pedido nuevo ' || NEW.numero
      || CASE WHEN NEW.domicilio_origen = 'pendiente' THEN ' · domicilio por definir' ELSE '' END,
    NEW.nombre_cliente || ' · ' || NEW.sabor || ' ' || NEW.tamano || ' · entrega '
      || to_char(NEW.fecha_entrega AT TIME ZONE v_zona, 'DD/MM HH24:MI'),
    '/pedidos', NEW.conversation_id, NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un aviso nunca debe impedir que se guarde el pedido.
  RAISE WARNING 'notif_pedido_nuevo: %', SQLERRM;
  RETURN NEW;
END;
$$;
