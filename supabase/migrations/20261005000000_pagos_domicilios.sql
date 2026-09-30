-- ============================================================
-- Cuentas de pago y domicilios configurables (30 sep 2026)
--
-- Antes: los datos de pago eran un texto fijo en reglas_negocio ('datos_pago')
-- y el domicilio no tenía precio. Ahora cada negocio los configura desde el
-- panel (Settings → Negocio):
--   - cuentas_pago: cuentas, llaves o billeteras (globales o de una sede)
--   - tarifas_domicilio: valor global, por sede y/o por zona o barrio
--
-- Flujo con domicilio (acordado con Neider):
--   1. El agente cotiza el domicilio ANTES de pedir el pago.
--   2. Si hay tarifa, la usa. Si no, una persona da el valor en el chat.
--   3. El cliente elige: pagar todo, solo el producto (domicilio antes del
--      envío) o el anticipo mínimo (60 % del producto).
-- El anticipo se calcula sobre el producto; el total y el saldo incluyen el
-- domicilio.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cuentas de pago
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cuentas_pago (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sede_id      UUID REFERENCES public.sedes(id) ON DELETE CASCADE,  -- NULL = todas las sedes
  tipo         TEXT NOT NULL CHECK (tipo IN ('ahorros', 'corriente', 'llave', 'billetera', 'otro')),
  banco        TEXT NOT NULL,            -- Bancolombia, Davivienda, Bre-B, Nequi…
  numero       TEXT NOT NULL,            -- número de cuenta, llave o celular
  titular      TEXT,
  documento    TEXT,                     -- 'NIT 901524286', 'CC 1.234.567'
  activa       BOOLEAN NOT NULL DEFAULT TRUE,
  orden        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuentas_pago_ws ON public.cuentas_pago (workspace_id, orden);

-- ------------------------------------------------------------
-- 2. Tarifas de domicilio
--    sede_id NULL = aplica a todas las sedes
--    zona NULL    = tarifa plana (cualquier dirección)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tarifas_domicilio (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sede_id      UUID REFERENCES public.sedes(id) ON DELETE CASCADE,
  zona         TEXT,
  valor        INTEGER NOT NULL CHECK (valor >= 0),
  activa       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una tarifa por combinación sede + zona (sin distinguir mayúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tarifas_domicilio
  ON public.tarifas_domicilio (
    workspace_id,
    COALESCE(sede_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(COALESCE(zona, ''))
  );

-- ------------------------------------------------------------
-- 3. Domicilio en el pedido
-- ------------------------------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS valor_domicilio  INTEGER NOT NULL DEFAULT 0 CHECK (valor_domicilio >= 0),
  ADD COLUMN IF NOT EXISTS domicilio_origen TEXT CHECK (domicilio_origen IN ('tarifa', 'persona'));

COMMENT ON COLUMN public.pedidos.valor_domicilio IS
  'Incluido en total. El anticipo se calcula sin el domicilio.';
COMMENT ON COLUMN public.pedidos.domicilio_origen IS
  'tarifa: de tarifas_domicilio · persona: valor que dio el equipo en el chat';

-- ------------------------------------------------------------
-- 4. Helpers
-- ------------------------------------------------------------
-- Minúsculas y sin tildes, para comparar barrios ("Barzal" = "barzál").
CREATE OR REPLACE FUNCTION public.pd_sin_tildes(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(lower(btrim(COALESCE(p, ''))), 'áéíóúüñàèìòù', 'aeiouunaeiou');
$$;

-- Texto con los datos de pago de una sede (sus cuentas + las globales).
-- Sin cuentas configuradas usa la regla antigua 'datos_pago' si existe.
CREATE OR REPLACE FUNCTION public.pd_datos_pago(p_ws UUID, p_sede_id UUID DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_titulares INTEGER;
  v_encabezado TEXT;
  v_lineas TEXT;
  v_nota TEXT;
BEGIN
  SELECT count(DISTINCT lower(btrim(COALESCE(titular, '')) || '|' || btrim(COALESCE(documento, ''))))
    INTO v_titulares
    FROM cuentas_pago
   WHERE workspace_id = p_ws AND activa
     AND (sede_id IS NULL OR sede_id = p_sede_id);

  IF v_titulares = 0 THEN
    RETURN (SELECT valor #>> '{}' FROM reglas_negocio
             WHERE workspace_id = p_ws AND clave = 'datos_pago');
  END IF;

  -- Un solo titular: va arriba. Varios: cada cuenta dice de quién es.
  IF v_titulares = 1 THEN
    SELECT NULLIF(concat_ws(' · ', NULLIF(btrim(titular), ''), NULLIF(btrim(documento), '')), '')
      INTO v_encabezado
      FROM cuentas_pago
     WHERE workspace_id = p_ws AND activa AND (sede_id IS NULL OR sede_id = p_sede_id)
     LIMIT 1;
  END IF;

  SELECT string_agg(
           '• ' || CASE tipo
                     WHEN 'ahorros'   THEN banco || ', cuenta de ahorros ' || numero
                     WHEN 'corriente' THEN banco || ', cuenta corriente ' || numero
                     WHEN 'llave'     THEN 'Llave ' || banco || ' ' || numero
                     ELSE banco || ' ' || numero
                   END
                || CASE WHEN v_titulares > 1 AND NULLIF(btrim(titular), '') IS NOT NULL
                        THEN ' (' || btrim(titular) || ')' ELSE '' END,
           E'\n' ORDER BY orden, created_at)
    INTO v_lineas
    FROM cuentas_pago
   WHERE workspace_id = p_ws AND activa AND (sede_id IS NULL OR sede_id = p_sede_id);

  v_nota := NULLIF(btrim((SELECT valor #>> '{}' FROM reglas_negocio
                           WHERE workspace_id = p_ws AND clave = 'nota_pagos')), '');

  RETURN concat_ws(E'\n', v_encabezado, v_lineas, v_nota);
END;
$$;

-- ------------------------------------------------------------
-- 5. pd_cotizar_domicilio — lo usa el agente antes de pedir el pago
--    Orden: zona de la sede > zona global > tarifa plana de la sede > plana global.
--    Entre zonas, gana la más específica (nombre más largo que aparece en la
--    dirección). Sin tarifa → requiere_persona.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_cotizar_domicilio(
  p_ws          UUID,
  p_sede_codigo TEXT,
  p_direccion   TEXT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_sede   sedes%ROWTYPE;
  v_dir    TEXT := pd_sin_tildes(p_direccion);
  v_tarifa tarifas_domicilio%ROWTYPE;
BEGIN
  SELECT * INTO v_sede FROM sedes
   WHERE workspace_id = p_ws AND lower(codigo) = lower(btrim(COALESCE(p_sede_codigo, ''))) AND activa;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEDE_NO_EXISTE',
      'sedes', (SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre))
                  FROM sedes WHERE workspace_id = p_ws AND activa));
  END IF;
  IF v_dir = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FALTA_DIRECCION_DOMICILIO');
  END IF;

  SELECT * INTO v_tarifa FROM tarifas_domicilio t
   WHERE t.workspace_id = p_ws AND t.activa
     AND (t.sede_id IS NULL OR t.sede_id = v_sede.id)
     AND (t.zona IS NULL OR btrim(t.zona) = ''
          OR position(pd_sin_tildes(t.zona) IN v_dir) > 0)
   ORDER BY
     (t.zona IS NOT NULL AND btrim(t.zona) <> '') DESC,   -- primero una zona que coincida
     (t.sede_id IS NOT NULL) DESC,                        -- luego la de la sede
     length(COALESCE(t.zona, '')) DESC                    -- la zona más específica
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'sede', v_sede.nombre,
      'valor', NULL,
      'requiere_persona', true,
      'nota', 'No hay tarifa configurada para esa dirección: una persona del equipo debe dar el valor.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'sede', v_sede.nombre,
    'valor', v_tarifa.valor,
    'zona', NULLIF(btrim(COALESCE(v_tarifa.zona, '')), ''),
    'requiere_persona', false
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. pd_registrar_pedido con valor del domicilio
--    Cambia la firma (nuevo parámetro): se borra la anterior para que no
--    queden dos versiones.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

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

  -- Domicilio: la tarifa configurada manda; si no hay, el valor que dio una
  -- persona del equipo en el chat. Sin ninguno de los dos no se registra.
  IF v_modal = 'domicilio' THEN
    v_dom := pd_cotizar_domicilio(p_ws, p_sede_codigo, p_direccion);
    IF (v_dom->>'ok')::boolean AND v_dom->>'valor' IS NOT NULL THEN
      v_valor_dom := (v_dom->>'valor')::int;
      v_origen := 'tarifa';
    ELSIF p_valor_domicilio IS NOT NULL AND p_valor_domicilio >= 0 THEN
      v_valor_dom := p_valor_domicilio;
      v_origen := 'persona';
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'FALTA_VALOR_DOMICILIO');
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
    v_prefijo := COALESCE((SELECT valor #>> '{}' FROM reglas_negocio
                            WHERE workspace_id = p_ws AND clave = 'prefijo_pedido'), 'PED');

    INSERT INTO pedidos (
      workspace_id, numero, contact_id, conversation_id, sede_id,
      nombre_cliente, telefono, linea, sabor, tamano, cantidad, detalle,
      modalidad, direccion_entrega, fecha_entrega,
      precio_unitario, total, anticipo_requerido, precio_validado,
      valor_domicilio, domicilio_origen
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
      v_valor_dom, v_origen
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

-- ------------------------------------------------------------
-- 7. Seguridad
-- ------------------------------------------------------------
ALTER TABLE public.cuentas_pago      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarifas_domicilio ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas_pago', 'tarifas_domicilio'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                    USING (workspace_id IN (SELECT auth_workspace_ids()))', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated
                    USING (auth_has_role(workspace_id, ARRAY[''admin'',''manager'']::workspace_role[]))
                    WITH CHECK (auth_has_role(workspace_id, ARRAY[''admin'',''manager'']::workspace_role[]))',
                   t || '_write', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cuentas_pago, public.tarifas_domicilio TO authenticated;
GRANT ALL ON public.cuentas_pago, public.tarifas_domicilio TO service_role;

REVOKE ALL ON FUNCTION public.pd_datos_pago(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_cotizar_domicilio(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_sin_tildes(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_datos_pago(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_cotizar_domicilio(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 8. Catálogo de herramientas
-- ------------------------------------------------------------
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('cotizar_domicilio', 'Cotizar domicilio',
   'Valor del domicilio según las tarifas del negocio (por sede, zona o global)',
   '{"type":"object","properties":{"sede":{"type":"string"},"direccion":{"type":"string"}},"required":["sede","direccion"]}',
   'read'),
  ('pasar_a_persona', 'Pasar a una persona',
   'Después de responder, pasa la conversación al equipo con el motivo (ej: cotizar un domicilio)',
   '{"type":"object","properties":{"motivo":{"type":"string"}},"required":["motivo"]}',
   'read'),
  ('registrar_pedido', 'Registrar pedido',
   'Crea el pedido en estado pendiente de anticipo con el precio del tarifario y el valor del domicilio',
   '{"type":"object","properties":{"sede":{"type":"string"},"linea":{"type":"string"},"sabor":{"type":"string"},"tamano":{"type":"string"},"cantidad":{"type":"integer"},"fecha_entrega":{"type":"string"},"nombre_cliente":{"type":"string"},"modalidad":{"type":"string"},"direccion_entrega":{"type":"string"},"valor_domicilio":{"type":"integer"}},"required":["sede","linea","tamano","fecha_entrega","nombre_cliente"]}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      schema = EXCLUDED.schema, sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20261005000000_pagos_domicilios
-- ============================================================
