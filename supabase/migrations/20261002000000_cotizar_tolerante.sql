-- ============================================================
-- Cotizar más tolerante (28 sep 2026)
-- Problema visto en pruebas: "Red Velvet de media libra" → el modelo mandó
-- linea='porcion' y no encontró precio. Ahora:
--   1. Normaliza tamaños y líneas ("media libra" → "1/2 lb", "ponqué" → ponque_personalizado).
--   2. Si no encuentra con la línea dada, busca por sabor + tamaño en todas
--      las líneas; si hay una sola coincidencia, la usa (y la devuelve).
--   3. Si no, devuelve opciones útiles: productos con ese sabor.
--   4. pd_registrar_pedido usa la línea que resolvió pd_cotizar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pd_norm_tamano(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t ~ '^(1/2|½|media|medio)( ?(lb|libra|libras))?$' OR t IN ('media libra', '1/2 libra') THEN '1/2 lb'
    WHEN t ~ '^(1/4|¼|un cuarto|cuarto)( de)?( ?(lb|libra|libras))$' THEN '1/4 lb'
    WHEN t ~ '^(1|una|un)( ?(lb|libra))$' OR t = 'libra' THEN '1 lb'
    WHEN t ~ '^(1/2|½|media)( ?(lb|libra))? larga$' THEN '1/2 lb larga'
    WHEN t ~ '^(1/4|¼|un cuarto|cuarto)( de)?( ?(lb|libra))? larga$' THEN '1/4 lb larga'
    WHEN t IN ('porción', 'porcion', 'una porción', 'una porcion', 'tajada') THEN 'porcion'
    ELSE t
  END
  FROM (SELECT regexp_replace(lower(btrim(COALESCE(p, ''))), '\s+', ' ', 'g') AS t) x;
$$;

CREATE OR REPLACE FUNCTION public.pd_norm_linea(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t IN ('ponque', 'ponqué', 'torta', 'pastel', 'ponque personalizado', 'ponqué personalizado',
               'torta personalizada', 'personalizado', 'ponques', 'ponqués') THEN 'ponque_personalizado'
    WHEN t IN ('porción', 'porciones', 'tajada') THEN 'porcion'
    ELSE replace(t, ' ', '_')
  END
  FROM (SELECT regexp_replace(lower(btrim(COALESCE(p, ''))), '\s+', ' ', 'g') AS t) x;
$$;

CREATE OR REPLACE FUNCTION public.pd_cotizar(
  p_ws       UUID,
  p_linea    TEXT,
  p_sabor    TEXT,
  p_tamano   TEXT,
  p_cantidad INTEGER DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_row    precios%ROWTYPE;
  v_linea  TEXT := pd_norm_linea(p_linea);
  v_sabor  TEXT := lower(btrim(COALESCE(NULLIF(p_sabor, ''), 'N/A')));
  v_tamano TEXT := pd_norm_tamano(p_tamano);
  v_n      INTEGER;
  v_pct    NUMERIC;
  v_total  INTEGER;
  v_ant    INTEGER;
BEGIN
  IF COALESCE(p_cantidad, 1) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANTIDAD_INVALIDA');
  END IF;

  -- 1. Coincidencia exacta (con línea y tamaño normalizados)
  SELECT * INTO v_row FROM precios
   WHERE workspace_id = p_ws AND vigente
     AND lower(linea) = v_linea AND lower(sabor) = v_sabor AND lower(tamano) = v_tamano
   LIMIT 1;

  -- 2. Sin la línea: sabor + tamaño, solo si hay una única coincidencia
  IF NOT FOUND THEN
    SELECT count(*) INTO v_n FROM precios
     WHERE workspace_id = p_ws AND vigente AND lower(sabor) = v_sabor AND lower(tamano) = v_tamano;
    IF v_n = 1 THEN
      SELECT * INTO v_row FROM precios
       WHERE workspace_id = p_ws AND vigente AND lower(sabor) = v_sabor AND lower(tamano) = v_tamano;
    END IF;
  END IF;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PRECIO_NO_ENCONTRADO',
      'buscado', jsonb_build_object('linea', v_linea, 'sabor', p_sabor, 'tamano', v_tamano),
      -- Lo más útil primero: en qué productos y tamaños existe ese sabor
      'productos_con_ese_sabor', (SELECT jsonb_agg(jsonb_build_object('linea', linea, 'tamano', tamano) ORDER BY linea, tamano)
                                    FROM precios WHERE workspace_id = p_ws AND vigente AND lower(sabor) = v_sabor),
      'lineas_disponibles', (SELECT jsonb_agg(DISTINCT linea) FROM precios WHERE workspace_id = p_ws AND vigente),
      'sabores_disponibles', (SELECT jsonb_agg(DISTINCT sabor) FROM precios
                               WHERE workspace_id = p_ws AND vigente AND lower(linea) = v_linea),
      'tamanos_disponibles', (SELECT jsonb_agg(DISTINCT tamano) FROM precios
                               WHERE workspace_id = p_ws AND vigente AND lower(linea) = v_linea)
    );
  END IF;

  v_pct   := pd_regla_num(p_ws, 'anticipo_pct', 60);
  v_total := v_row.precio * COALESCE(p_cantidad, 1);
  v_ant   := CEIL(v_total * v_pct / 100.0)::int;

  RETURN jsonb_build_object(
    'ok', true,
    'linea', v_row.linea, 'sabor', v_row.sabor, 'tamano', v_row.tamano,
    'porciones', v_row.porciones, 'incluye', v_row.incluye,
    'precio_unitario', v_row.precio,
    'cantidad', COALESCE(p_cantidad, 1),
    'total', v_total,
    'anticipo_pct', v_pct,
    'anticipo', v_ant,
    'saldo', v_total - v_ant,
    'precio_validado', v_row.validado
  );
END;
$$;

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
  p_detalle         JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_cot    JSONB;
  v_cupo   JSONB;
  v_sede   sedes%ROWTYPE;
  v_fecha  TIMESTAMPTZ := pd_parse_fecha(p_ws, p_fecha_entrega);
  v_prefijo TEXT;
  v_existe pedidos%ROWTYPE;
  v_ped    pedidos%ROWTYPE;
  v_tel    TEXT := p_telefono;
BEGIN
  IF btrim(COALESCE(p_nombre_cliente, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FALTA_NOMBRE_CLIENTE');
  END IF;
  IF p_modalidad = 'domicilio' AND btrim(COALESCE(p_direccion, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FALTA_DIRECCION_DOMICILIO');
  END IF;

  v_cot := pd_cotizar(p_ws, p_linea, p_sabor, p_tamano, p_cantidad);
  IF NOT (v_cot->>'ok')::boolean THEN
    RETURN v_cot;
  END IF;

  v_cupo := pd_consultar_cupo(p_ws, p_sede_codigo, p_fecha_entrega, p_cantidad,
                              lower(v_cot->>'linea') = 'ponque_personalizado');
  IF NOT (v_cupo->>'ok')::boolean THEN
    RETURN v_cupo;
  END IF;
  IF NOT (v_cupo->>'disponible')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_DISPONIBLE',
                              'motivos', v_cupo->'motivos', 'detalle', v_cupo);
  END IF;

  SELECT * INTO v_sede FROM sedes
   WHERE workspace_id = p_ws AND lower(codigo) = lower(btrim(p_sede_codigo));

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
    RETURN jsonb_build_object('ok', true, 'duplicado', true,
      'numero', v_existe.numero, 'total', v_existe.total,
      'anticipo', v_existe.anticipo_requerido,
      'saldo_contra_entrega', v_existe.total - v_existe.anticipo_requerido,
      'estado', v_existe.estado);
  END IF;

  v_prefijo := COALESCE((SELECT valor #>> '{}' FROM reglas_negocio
                          WHERE workspace_id = p_ws AND clave = 'prefijo_pedido'), 'PED');

  INSERT INTO pedidos (
    workspace_id, numero, contact_id, conversation_id, sede_id,
    nombre_cliente, telefono, linea, sabor, tamano, cantidad, detalle,
    modalidad, direccion_entrega, fecha_entrega,
    precio_unitario, total, anticipo_requerido, precio_validado
  ) VALUES (
    p_ws, v_prefijo || '-' || lpad(nextval('pedidos_numero_seq')::text, 5, '0'),
    p_contact_id, p_conversation_id, v_sede.id,
    btrim(p_nombre_cliente), v_tel, v_cot->>'linea', v_cot->>'sabor', v_cot->>'tamano',
    (v_cot->>'cantidad')::int, COALESCE(p_detalle, '{}'::jsonb),
    COALESCE(p_modalidad, 'recogida'), p_direccion, v_fecha,
    (v_cot->>'precio_unitario')::int, (v_cot->>'total')::int, (v_cot->>'anticipo')::int,
    (v_cot->>'precio_validado')::boolean
  ) RETURNING * INTO v_ped;

  RETURN jsonb_build_object(
    'ok', true,
    'numero', v_ped.numero,
    'sede', v_sede.nombre,
    'fecha_entrega_local', v_cupo->>'fecha_local',
    'producto', v_ped.sabor || ' ' || v_ped.tamano,
    'cantidad', v_ped.cantidad,
    'total', v_ped.total,
    'anticipo', v_ped.anticipo_requerido,
    'saldo_contra_entrega', v_ped.total - v_ped.anticipo_requerido,
    'estado', v_ped.estado,
    'datos_pago', (SELECT valor FROM reglas_negocio WHERE workspace_id = p_ws AND clave = 'datos_pago'),
    'precio_validado', v_ped.precio_validado
  );
END;
$$;

-- Mismos permisos que antes
REVOKE ALL ON FUNCTION public.pd_cotizar(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_cotizar(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
