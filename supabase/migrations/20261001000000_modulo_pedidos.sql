-- ============================================================
-- Migration: 20261001000000_modulo_pedidos
-- AI for PYMES — Módulo de pedidos (primer vertical: pastelería / Golosita)
--
-- Agrega al fork de whatsapp-saas lo que el repo base no trae:
--   sedes, reglas_negocio, precios, pedidos y pagos_pedido (por workspace)
--   + funciones que usan las herramientas del agente:
--     pd_cotizar, pd_consultar_cupo, pd_registrar_pedido,
--     pd_registrar_comprobante, pd_confirmar_pago
--   + filas en el catálogo public.tools para activarlas por workspace.
--
-- Principio: el LLM NUNCA calcula precios ni decide cupos. Todo sale de aquí.
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Sedes (puntos de venta del negocio)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sedes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  codigo                TEXT NOT NULL,                 -- 'caudal', 'buque', 'amarilo'
  nombre                TEXT NOT NULL,
  direccion             TEXT,
  telefono              TEXT,
  acepta_personalizados BOOLEAN NOT NULL DEFAULT FALSE,
  horarios              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"lunes":["10:00","19:30"], ...}
  cupo_diario           INTEGER NOT NULL DEFAULT 0 CHECK (cupo_diario >= 0), -- 0 = sin límite
  activa                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, codigo)
);

-- ------------------------------------------------------------
-- 2. Reglas de negocio configurables (anticipo, anticipación, etc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reglas_negocio (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  clave        TEXT NOT NULL,
  valor        JSONB NOT NULL,
  descripcion  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, clave)
);

-- ------------------------------------------------------------
-- 3. Tarifario (fuente única de precios)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.precios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  linea        TEXT NOT NULL,     -- 'ponque_personalizado' | 'porcion' | 'largo' | ...
  sabor        TEXT NOT NULL,     -- 'N/A' si no aplica
  tamano       TEXT NOT NULL,     -- '1/4 lb' | '1/2 lb' | '1 lb' | 'porcion' ...
  porciones    TEXT,
  precio       INTEGER NOT NULL CHECK (precio >= 0),  -- COP
  incluye      TEXT,
  vigente      BOOLEAN NOT NULL DEFAULT TRUE,
  validado     BOOLEAN NOT NULL DEFAULT FALSE,        -- FALSE hasta que el cliente lo apruebe
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, linea, sabor, tamano)
);
CREATE INDEX IF NOT EXISTS idx_precios_lookup ON public.precios (workspace_id, linea);

-- ------------------------------------------------------------
-- 4. Pedidos
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.pedidos_numero_seq START 1;

CREATE TABLE IF NOT EXISTS public.pedidos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  numero             TEXT NOT NULL,
  contact_id         UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id    UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  sede_id            UUID NOT NULL REFERENCES public.sedes(id),
  nombre_cliente     TEXT NOT NULL,
  telefono           TEXT,
  linea              TEXT NOT NULL,
  sabor              TEXT NOT NULL,
  tamano             TEXT NOT NULL,
  cantidad           INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  detalle            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- decoración, mensaje, forma, cubierta…
  modalidad          TEXT NOT NULL DEFAULT 'recogida' CHECK (modalidad IN ('recogida', 'domicilio')),
  direccion_entrega  TEXT,
  fecha_entrega      TIMESTAMPTZ NOT NULL,
  precio_unitario    INTEGER NOT NULL,
  total              INTEGER NOT NULL CHECK (total >= 0),
  anticipo_requerido INTEGER NOT NULL CHECK (anticipo_requerido >= 0),
  pagado             INTEGER NOT NULL DEFAULT 0 CHECK (pagado >= 0),
  saldo              INTEGER GENERATED ALWAYS AS (total - pagado) STORED,
  precio_validado    BOOLEAN NOT NULL DEFAULT FALSE,
  estado             TEXT NOT NULL DEFAULT 'pendiente_anticipo' CHECK (estado IN (
                       'pendiente_anticipo', 'por_verificar', 'confirmado',
                       'en_produccion', 'listo', 'entregado', 'cancelado')),
  creado_por         TEXT NOT NULL DEFAULT 'agente',
  notas              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_pedidos_agenda
  ON public.pedidos (workspace_id, sede_id, fecha_entrega);
CREATE INDEX IF NOT EXISTS idx_pedidos_conversation
  ON public.pedidos (conversation_id, created_at DESC);

-- ------------------------------------------------------------
-- 5. Pagos / comprobantes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagos_pedido (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pedido_id        UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL DEFAULT 'anticipo' CHECK (tipo IN ('anticipo', 'saldo', 'total')),
  monto_esperado   INTEGER NOT NULL,
  monto_reportado  INTEGER,
  referencia       TEXT,
  banco            TEXT,
  fecha_pago       TEXT,
  message_id       UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  media            JSONB,          -- copia de messages.media (ruta del archivo en Storage)
  descripcion_ia   TEXT,           -- lo que la IA leyó de la imagen
  estado           TEXT NOT NULL DEFAULT 'por_verificar'
                     CHECK (estado IN ('por_verificar', 'confirmado', 'rechazado')),
  revisado_por     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  revisado_at      TIMESTAMPTZ,
  motivo_rechazo   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_referencia
  ON public.pagos_pedido (workspace_id, lower(referencia))
  WHERE referencia IS NOT NULL AND estado <> 'rechazado';
CREATE INDEX IF NOT EXISTS idx_pagos_pendientes
  ON public.pagos_pedido (workspace_id, estado, created_at DESC);

-- updated_at automático (función del repo base)
DROP TRIGGER IF EXISTS trg_pedidos_updated_at ON public.pedidos;
CREATE TRIGGER trg_pedidos_updated_at BEFORE UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6. Funciones internas
-- ============================================================

-- Valor numérico de una regla, con valor por defecto
CREATE OR REPLACE FUNCTION public.pd_regla_num(p_ws UUID, p_clave TEXT, p_default NUMERIC)
RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT (valor #>> '{}')::numeric FROM reglas_negocio
                    WHERE workspace_id = p_ws AND clave = p_clave), p_default);
$$;

-- Zona horaria del negocio (regla 'zona_horaria' o America/Bogota)
CREATE OR REPLACE FUNCTION public.pd_zona(p_ws UUID)
RETURNS TEXT
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT valor #>> '{}' FROM reglas_negocio
                    WHERE workspace_id = p_ws AND clave = 'zona_horaria'), 'America/Bogota');
$$;

-- Convierte el texto de fecha que manda el agente a timestamptz.
-- Con offset/Z se respeta; sin offset se interpreta en la hora local del negocio.
CREATE OR REPLACE FUNCTION public.pd_parse_fecha(p_ws UUID, p_fecha TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_fecha IS NULL OR btrim(p_fecha) = '' THEN
    RETURN NULL;
  END IF;
  IF btrim(p_fecha) ~* '(z|[+-]\d{2}(:?\d{2})?)$' THEN
    RETURN btrim(p_fecha)::timestamptz;
  END IF;
  RETURN (btrim(p_fecha)::timestamp) AT TIME ZONE pd_zona(p_ws);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ============================================================
-- 7. pd_cotizar — precio, anticipo y saldo (el LLM nunca calcula)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pd_cotizar(
  p_ws       UUID,
  p_linea    TEXT,
  p_sabor    TEXT,
  p_tamano   TEXT,
  p_cantidad INTEGER DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_row   precios%ROWTYPE;
  v_pct   NUMERIC;
  v_total INTEGER;
  v_ant   INTEGER;
BEGIN
  IF COALESCE(p_cantidad, 1) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANTIDAD_INVALIDA');
  END IF;

  SELECT * INTO v_row FROM precios
   WHERE workspace_id = p_ws AND vigente
     AND lower(linea)  = lower(btrim(p_linea))
     AND lower(sabor)  = lower(btrim(COALESCE(NULLIF(p_sabor, ''), 'N/A')))
     AND lower(tamano) = lower(btrim(p_tamano))
   LIMIT 1;

  IF NOT FOUND THEN
    -- Devuelve opciones reales para que el agente pregunte bien
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PRECIO_NO_ENCONTRADO',
      'lineas_disponibles', (SELECT jsonb_agg(DISTINCT linea) FROM precios WHERE workspace_id = p_ws AND vigente),
      'sabores_disponibles', (SELECT jsonb_agg(DISTINCT sabor) FROM precios
                               WHERE workspace_id = p_ws AND vigente AND lower(linea) = lower(btrim(p_linea))),
      'tamanos_disponibles', (SELECT jsonb_agg(DISTINCT tamano) FROM precios
                               WHERE workspace_id = p_ws AND vigente AND lower(linea) = lower(btrim(p_linea)))
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

-- ============================================================
-- 8. pd_consultar_cupo — sede, anticipación mínima, horario y cupo del día
-- ============================================================
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
  v_usados INTEGER := 0;
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

  SELECT COALESCE(SUM(cantidad), 0) INTO v_usados FROM pedidos
   WHERE workspace_id = p_ws AND sede_id = v_sede.id
     AND (fecha_entrega AT TIME ZONE v_tz)::date = v_local::date
     AND estado NOT IN ('pendiente_anticipo', 'cancelado');

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
  IF v_sede.cupo_diario > 0 AND v_usados + COALESCE(p_cantidad, 1) > v_sede.cupo_diario THEN
    v_motivos := array_append(v_motivos, 'SIN_CUPO');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'disponible', cardinality(v_motivos) = 0,
    'motivos', to_jsonb(v_motivos),
    'sede', v_sede.nombre,
    'sede_codigo', v_sede.codigo,
    'fecha_local', to_char(v_local, 'YYYY-MM-DD HH24:MI'),
    'dia', v_dia,
    'horario_sede', v_rango,
    'horas_de_anticipacion', v_horas,
    'anticipacion_minima_horas', v_min_h,
    'cupo_diario', v_sede.cupo_diario,
    'pedidos_ese_dia', v_usados,
    'ahora_local', to_char(now() AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI')
  );
END;
$$;

-- ============================================================
-- 9. pd_registrar_pedido — valida todo otra vez y guarda (estado pendiente_anticipo)
-- ============================================================
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
                              lower(p_linea) = 'ponque_personalizado');
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

-- ============================================================
-- 10. pd_registrar_comprobante — deja el pago "por verificar" (lo confirma una persona)
-- ============================================================
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
    SELECT * INTO v_ped FROM pedidos
     WHERE workspace_id = p_ws AND upper(numero) = upper(btrim(p_numero_pedido));
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

-- ============================================================
-- 11. pd_confirmar_pago — lo usa el panel (persona del equipo)
-- ============================================================
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

-- ============================================================
-- 12. Seguridad
-- ============================================================
ALTER TABLE public.sedes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reglas_negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_pedido   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sedes','reglas_negocio','precios','pedidos','pagos_pedido'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                    USING (workspace_id IN (SELECT auth_workspace_ids()))', t || '_select', t);
  END LOOP;
END $$;

-- Catálogo (precios, sedes, reglas): lo editan admin/manager desde el panel
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sedes','reglas_negocio','precios'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated
                    USING (auth_has_role(workspace_id, ARRAY[''admin'',''manager'']::workspace_role[]))
                    WITH CHECK (auth_has_role(workspace_id, ARRAY[''admin'',''manager'']::workspace_role[]))',
                   t || '_write', t);
  END LOOP;
END $$;

-- Pedidos: el equipo puede actualizar estado (producción, listo, entregado)
DROP POLICY IF EXISTS pedidos_update ON public.pedidos;
CREATE POLICY pedidos_update ON public.pedidos FOR UPDATE TO authenticated
  USING (auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[]))
  WITH CHECK (auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[]));

-- Las funciones de escritura solo las ejecuta el servidor (service_role)
REVOKE ALL ON FUNCTION public.pd_cotizar(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_consultar_cupo(UUID, TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pd_registrar_comprobante(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pd_confirmar_pago(UUID, BOOLEAN, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_cotizar(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_consultar_cupo(UUID, TEXT, TEXT, INTEGER, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.pd_registrar_comprobante(UUID, UUID, TEXT, INTEGER, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pd_confirmar_pago(UUID, BOOLEAN, INTEGER, TEXT) TO authenticated, service_role;

-- ============================================================
-- 13. Catálogo de herramientas (se activan por workspace en Settings → Tools)
-- ============================================================
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('cotizar_producto', 'Cotizar producto',
   'Precio, anticipo y saldo desde el tarifario del negocio',
   '{"type":"object","properties":{"linea":{"type":"string"},"sabor":{"type":"string"},"tamano":{"type":"string"},"cantidad":{"type":"integer"}},"required":["linea","tamano"]}',
   'read'),
  ('consultar_cupo', 'Consultar cupo y anticipación',
   'Valida sede, anticipación mínima, horario y cupo diario para una fecha de entrega',
   '{"type":"object","properties":{"sede":{"type":"string"},"fecha_entrega":{"type":"string"},"cantidad":{"type":"integer"},"personalizado":{"type":"boolean"}},"required":["sede","fecha_entrega"]}',
   'read'),
  ('registrar_pedido', 'Registrar pedido',
   'Crea el pedido en estado pendiente de anticipo con el precio del tarifario',
   '{"type":"object","properties":{"sede":{"type":"string"},"linea":{"type":"string"},"sabor":{"type":"string"},"tamano":{"type":"string"},"cantidad":{"type":"integer"},"fecha_entrega":{"type":"string"},"nombre_cliente":{"type":"string"}},"required":["sede","linea","tamano","fecha_entrega","nombre_cliente"]}',
   'write'),
  ('registrar_comprobante', 'Registrar comprobante de pago',
   'Guarda el comprobante enviado por el cliente y deja el pedido por verificar',
   '{"type":"object","properties":{"numero_pedido":{"type":"string"},"monto":{"type":"integer"},"referencia":{"type":"string"},"banco":{"type":"string"},"fecha_pago":{"type":"string"}}}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      schema = EXCLUDED.schema, sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20261001000000_modulo_pedidos
-- ============================================================
