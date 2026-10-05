-- ============================================================
-- Migration: 20261009000000_catalogo_productos
-- AI for PYMES — Catálogo de productos por workspace + disponibilidad por sede
--
-- Reemplaza el tarifario plano (public.precios: linea + sabor + tamaño) por:
--   productos            — qué vende el negocio (nombre, categoría, imágenes,
--                          modo de disponibilidad, origen manual/shopify)
--   producto_variantes   — precio por combinación de opciones (sabor, tamaño…)
--   disponibilidad_sede  — menú del día: variante × sede × fecha, con cantidad
--                          opcional. Lo edita el equipo desde el panel.
--
-- Modos de disponibilidad (productos.modo_disponibilidad):
--   siempre      — se vende en el horario de la sede (bebidas, porciones),
--                  salvo que la sede lo marque agotado ese día o le cargue
--                  una cantidad (que también se descuenta)
--   por_dia      — solo si está cargado en el menú de ese día y sede; al
--                  registrar el pedido se descuenta la cantidad
--   bajo_pedido  — se hace por encargo: aplica anticipación y cupo diario
--                  (reemplaza el chequeo fijo de la línea 'ponque_personalizado')
--
-- La tabla interna es la fuente de verdad. Shopify (fase 2) solo importa:
-- `origen`, `external_id` y `editado_localmente` quedan listos para eso.
--
-- Las herramientas del agente no cambian de firma: pd_cotizar y
-- pd_registrar_pedido siguen recibiendo linea / sabor / tamaño, donde la
-- línea es el slug del producto y sabor/tamaño son opciones de la variante.
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Productos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.productos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug                TEXT NOT NULL,                -- lo que el agente manda como "linea"
  nombre              TEXT NOT NULL,
  categoria           TEXT,
  descripcion         TEXT,
  imagenes            JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["https://…", …]
  modo_disponibilidad TEXT NOT NULL DEFAULT 'siempre'
                        CHECK (modo_disponibilidad IN ('siempre', 'por_dia', 'bajo_pedido')),
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  origen              TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'shopify')),
  external_id         TEXT,                          -- id del producto en Shopify
  editado_localmente  BOOLEAN NOT NULL DEFAULT FALSE, -- la reimportación no lo pisa
  orden               INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, slug),
  CONSTRAINT uq_productos_workspace_id UNIQUE (workspace_id, id),
  CHECK (jsonb_typeof(imagenes) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_externo
  ON public.productos (workspace_id, origen, external_id) WHERE external_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Variantes (precio por combinación de opciones)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.producto_variantes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  producto_id        UUID NOT NULL,
  opciones           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"sabor":"Red Velvet","tamano":"1/2 lb"}
  porciones          TEXT,
  incluye            TEXT,
  precio             INTEGER NOT NULL CHECK (precio >= 0),  -- moneda local, sin decimales
  validado           BOOLEAN NOT NULL DEFAULT FALSE,        -- FALSE hasta que el negocio lo apruebe
  activa             BOOLEAN NOT NULL DEFAULT TRUE,
  sku                TEXT,
  external_id        TEXT,                                  -- id de la variante en Shopify
  editado_localmente BOOLEAN NOT NULL DEFAULT FALSE,
  orden              INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_producto_variantes_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_variantes_producto FOREIGN KEY (workspace_id, producto_id)
    REFERENCES public.productos (workspace_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(opciones) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_opciones
  ON public.producto_variantes (producto_id, opciones);
CREATE INDEX IF NOT EXISTS idx_variantes_workspace
  ON public.producto_variantes (workspace_id, producto_id);

-- ------------------------------------------------------------
-- 3. Disponibilidad por sede y día (menú del día)
--    cantidad NULL = disponible sin contar unidades.
-- ------------------------------------------------------------
-- sedes necesita la clave compuesta para las FK consistentes por workspace
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.sedes'::regclass AND conname = 'uq_sedes_workspace_id') THEN
    ALTER TABLE public.sedes ADD CONSTRAINT uq_sedes_workspace_id UNIQUE (workspace_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.disponibilidad_sede (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  variante_id  UUID NOT NULL,
  sede_id      UUID NOT NULL,
  fecha        DATE NOT NULL,
  disponible   BOOLEAN NOT NULL DEFAULT TRUE,
  cantidad     INTEGER CHECK (cantidad IS NULL OR cantidad >= 0),
  actualizado_por UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (variante_id, sede_id, fecha),
  CONSTRAINT fk_disponibilidad_variante FOREIGN KEY (workspace_id, variante_id)
    REFERENCES public.producto_variantes (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_disponibilidad_sede FOREIGN KEY (workspace_id, sede_id)
    REFERENCES public.sedes (workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_disponibilidad_dia
  ON public.disponibilidad_sede (workspace_id, sede_id, fecha);

-- Pedidos: qué variante se vendió y cuántas unidades se descontaron del menú
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS variante_id UUID,
  ADD COLUMN IF NOT EXISTS disponibilidad_descontada INTEGER NOT NULL DEFAULT 0
    CHECK (disponibilidad_descontada >= 0);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pedidos'::regclass AND conname = 'fk_pedidos_variante') THEN
    ALTER TABLE public.pedidos ADD CONSTRAINT fk_pedidos_variante
      FOREIGN KEY (workspace_id, variante_id)
      REFERENCES public.producto_variantes (workspace_id, id) ON DELETE SET NULL (variante_id);
  END IF;
END $$;

-- updated_at automático (función del repo base)
DROP TRIGGER IF EXISTS trg_productos_updated_at ON public.productos;
CREATE TRIGGER trg_productos_updated_at BEFORE UPDATE ON public.productos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_variantes_updated_at ON public.producto_variantes;
CREATE TRIGGER trg_variantes_updated_at BEFORE UPDATE ON public.producto_variantes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_disponibilidad_updated_at ON public.disponibilidad_sede;
CREATE TRIGGER trg_disponibilidad_updated_at BEFORE UPDATE ON public.disponibilidad_sede
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 4. Helpers
-- ------------------------------------------------------------
-- "Ponqué Personalizado" → 'ponque_personalizado'
CREATE OR REPLACE FUNCTION public.cat_slug(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(pd_sin_tildes(p), '[^a-z0-9/]+', '_', 'g'), '_');
$$;

-- Crea o actualiza un producto y su variante desde una fila del tarifario
-- antiguo (linea, sabor, tamaño). La usan esta migración y los seeds.
CREATE OR REPLACE FUNCTION public.cat_upsert_tarifa(
  p_ws        UUID,
  p_linea     TEXT,
  p_sabor     TEXT,
  p_tamano    TEXT,
  p_porciones TEXT,
  p_precio    INTEGER,
  p_incluye   TEXT DEFAULT NULL,
  p_validado  BOOLEAN DEFAULT FALSE,
  p_activa    BOOLEAN DEFAULT TRUE
) RETURNS UUID
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_slug     TEXT := cat_slug(p_linea);
  v_producto UUID;
  v_opciones JSONB;
  v_id       UUID;
BEGIN
  INSERT INTO productos (workspace_id, slug, nombre, modo_disponibilidad)
  VALUES (p_ws, v_slug, initcap(replace(v_slug, '_', ' ')),
          CASE WHEN v_slug = 'ponque_personalizado' THEN 'bajo_pedido' ELSE 'siempre' END)
  ON CONFLICT (workspace_id, slug) DO UPDATE SET slug = EXCLUDED.slug
  RETURNING id INTO v_producto;

  v_opciones := jsonb_strip_nulls(jsonb_build_object(
    'sabor',  NULLIF(NULLIF(btrim(p_sabor), ''), 'N/A'),
    'tamano', NULLIF(btrim(p_tamano), '')));

  INSERT INTO producto_variantes (workspace_id, producto_id, opciones, porciones, precio,
                                  incluye, validado, activa)
  VALUES (p_ws, v_producto, v_opciones, p_porciones, p_precio, p_incluye, p_validado, p_activa)
  ON CONFLICT (producto_id, opciones) DO UPDATE SET
    porciones = EXCLUDED.porciones, precio = EXCLUDED.precio, incluye = EXCLUDED.incluye,
    activa = EXCLUDED.activa
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Texto legible de una variante: "Red Velvet · 1/2 lb"
CREATE OR REPLACE FUNCTION public.cat_nombre_variante(p_opciones JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(concat_ws(' · ', p_opciones->>'sabor', p_opciones->>'tamano',
           (SELECT string_agg(value, ' · ' ORDER BY key) FROM jsonb_each_text(p_opciones)
             WHERE key NOT IN ('sabor', 'tamano'))), '');
$$;

-- ------------------------------------------------------------
-- 5. Migrar el tarifario antiguo y retirar public.precios
-- ------------------------------------------------------------
DO $$
DECLARE
  v_antes   INTEGER;
  v_despues INTEGER;
BEGIN
  IF to_regclass('public.precios') IS NULL THEN
    RETURN;
  END IF;

  PERFORM cat_upsert_tarifa(workspace_id, linea, sabor, tamano, porciones, precio,
                            incluye, validado, vigente)
     FROM public.precios;
  -- validado se respeta tal cual venía (el upsert no lo pisa al reaplicar)
  UPDATE producto_variantes v SET validado = TRUE
    FROM productos p, public.precios pr
   WHERE v.producto_id = p.id AND pr.workspace_id = p.workspace_id AND pr.validado
     AND cat_slug(pr.linea) = p.slug
     AND v.opciones = jsonb_strip_nulls(jsonb_build_object(
           'sabor', NULLIF(NULLIF(btrim(pr.sabor), ''), 'N/A'), 'tamano', NULLIF(btrim(pr.tamano), '')));

  SELECT count(*) INTO v_antes FROM public.precios;
  SELECT count(*) INTO v_despues FROM producto_variantes v
    JOIN productos p ON p.id = v.producto_id
   WHERE EXISTS (SELECT 1 FROM public.precios pr
                  WHERE pr.workspace_id = p.workspace_id AND cat_slug(pr.linea) = p.slug);
  IF v_despues < v_antes THEN
    RAISE EXCEPTION 'Migración del tarifario incompleta: % precios, % variantes', v_antes, v_despues;
  END IF;

  DROP TABLE public.precios;
END $$;

-- ------------------------------------------------------------
-- 6. pd_cotizar sobre el catálogo (misma firma y misma tolerancia)
-- ------------------------------------------------------------
-- Variantes vendibles de un workspace con los campos de comparación normalizados
CREATE OR REPLACE FUNCTION public.cat_vendibles(p_ws UUID)
RETURNS TABLE (variante_id UUID, producto_id UUID, slug TEXT, nombre_norm TEXT, sabor TEXT, tamano TEXT)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT v.id, p.id, p.slug, cat_slug(p.nombre),
         pd_sin_tildes(COALESCE(v.opciones->>'sabor', 'N/A')),
         pd_norm_tamano(COALESCE(v.opciones->>'tamano', ''))
    FROM producto_variantes v JOIN productos p ON p.id = v.producto_id
   WHERE p.workspace_id = p_ws AND p.activo AND v.activa;
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
  v_linea  TEXT := pd_norm_linea(p_linea);
  v_slug   TEXT := cat_slug(p_linea);
  v_sabor  TEXT := pd_sin_tildes(COALESCE(NULLIF(btrim(p_sabor), ''), 'N/A'));
  v_tamano TEXT := pd_norm_tamano(p_tamano);
  v_var    UUID;
  v_n      INTEGER;
  v_row    RECORD;
  v_pct    NUMERIC;
  v_total  INTEGER;
  v_ant    INTEGER;
BEGIN
  IF COALESCE(p_cantidad, 1) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANTIDAD_INVALIDA');
  END IF;

  -- 1. Coincidencia exacta: producto (slug, línea normalizada o nombre) + sabor + tamaño
  SELECT variante_id INTO v_var FROM cat_vendibles(p_ws)
   WHERE (slug IN (v_linea, v_slug) OR nombre_norm = v_slug)
     AND sabor = v_sabor AND tamano = v_tamano
   LIMIT 1;

  -- 2. Sin el producto: sabor + tamaño, solo si hay una única coincidencia
  IF v_var IS NULL THEN
    SELECT count(*) INTO v_n FROM cat_vendibles(p_ws) WHERE sabor = v_sabor AND tamano = v_tamano;
    IF v_n = 1 THEN
      SELECT variante_id INTO v_var FROM cat_vendibles(p_ws) WHERE sabor = v_sabor AND tamano = v_tamano;
    END IF;
  END IF;

  -- 3. Producto con una sola variante (sin opciones que elegir)
  IF v_var IS NULL THEN
    SELECT count(*) INTO v_n FROM cat_vendibles(p_ws) WHERE slug IN (v_linea, v_slug) OR nombre_norm = v_slug;
    IF v_n = 1 THEN
      SELECT variante_id INTO v_var FROM cat_vendibles(p_ws) WHERE slug IN (v_linea, v_slug) OR nombre_norm = v_slug;
    END IF;
  END IF;

  IF v_var IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'PRECIO_NO_ENCONTRADO',
      'buscado', jsonb_build_object('linea', v_linea, 'sabor', p_sabor, 'tamano', v_tamano),
      -- Lo más útil primero: en qué productos y tamaños existe ese sabor
      'productos_con_ese_sabor', (SELECT jsonb_agg(jsonb_build_object('linea', c.slug, 'tamano', v.opciones->>'tamano')
                                                   ORDER BY c.slug, v.opciones->>'tamano')
                                    FROM cat_vendibles(p_ws) c JOIN producto_variantes v ON v.id = c.variante_id
                                   WHERE c.sabor = v_sabor),
      'lineas_disponibles', (SELECT jsonb_agg(DISTINCT slug) FROM cat_vendibles(p_ws)),
      'sabores_disponibles', (SELECT jsonb_agg(DISTINCT v.opciones->>'sabor')
                                FROM cat_vendibles(p_ws) c JOIN producto_variantes v ON v.id = c.variante_id
                               WHERE c.slug IN (v_linea, v_slug) AND v.opciones ? 'sabor'),
      'tamanos_disponibles', (SELECT jsonb_agg(DISTINCT v.opciones->>'tamano')
                                FROM cat_vendibles(p_ws) c JOIN producto_variantes v ON v.id = c.variante_id
                               WHERE c.slug IN (v_linea, v_slug) AND v.opciones ? 'tamano')
    );
  END IF;

  SELECT v.id, v.opciones, v.porciones, v.incluye, v.precio, v.validado,
         p.slug, p.nombre, p.modo_disponibilidad
    INTO v_row
    FROM producto_variantes v JOIN productos p ON p.id = v.producto_id
   WHERE v.id = v_var;

  v_pct   := pd_regla_num(p_ws, 'anticipo_pct', 60);
  v_total := v_row.precio * COALESCE(p_cantidad, 1);
  v_ant   := CEIL(v_total * v_pct / 100.0)::int;

  RETURN jsonb_build_object(
    'ok', true,
    'variante_id', v_row.id,
    'producto', v_row.nombre,
    'linea', v_row.slug,
    'sabor', COALESCE(v_row.opciones->>'sabor', 'N/A'),
    'tamano', COALESCE(v_row.opciones->>'tamano', ''),
    'modo_disponibilidad', v_row.modo_disponibilidad,
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

-- ------------------------------------------------------------
-- 7. Disponibilidad de una variante en una sede y fecha
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_disponibilidad_variante(
  p_ws UUID, p_variante_id UUID, p_sede_id UUID, p_fecha DATE
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_modo TEXT;
  v_disp disponibilidad_sede%ROWTYPE;
BEGIN
  SELECT p.modo_disponibilidad INTO v_modo
    FROM producto_variantes v JOIN productos p ON p.id = v.producto_id
   WHERE v.id = p_variante_id AND v.workspace_id = p_ws;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('disponible', false, 'motivo', 'PRODUCTO_NO_EXISTE');
  END IF;
  IF v_modo = 'bajo_pedido' THEN
    RETURN jsonb_build_object('modo', v_modo, 'disponible', true, 'cantidad', NULL);
  END IF;

  SELECT * INTO v_disp FROM disponibilidad_sede
   WHERE variante_id = p_variante_id AND sede_id = p_sede_id AND fecha = p_fecha;
  IF NOT FOUND THEN
    -- 'siempre' está disponible si nadie lo marcó; 'por_dia' necesita el menú cargado
    RETURN CASE WHEN v_modo = 'siempre'
      THEN jsonb_build_object('modo', v_modo, 'disponible', true, 'cantidad', NULL)
      ELSE jsonb_build_object('modo', v_modo, 'disponible', false, 'motivo', 'MENU_SIN_CARGAR') END;
  END IF;
  IF NOT v_disp.disponible OR v_disp.cantidad = 0 THEN
    RETURN jsonb_build_object('modo', v_modo, 'disponible', false, 'motivo', 'AGOTADO', 'cantidad', 0);
  END IF;
  RETURN jsonb_build_object('modo', v_modo, 'disponible', true, 'cantidad', v_disp.cantidad);
END;
$$;

-- ------------------------------------------------------------
-- 8. pd_consultar_disponibilidad — herramienta del agente
--    "¿Qué hay hoy en Buque?" / "¿Tienen golovesa de tiramisú mañana?"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pd_consultar_disponibilidad(
  p_ws          UUID,
  p_sede_codigo TEXT,
  p_fecha       TEXT DEFAULT NULL,   -- YYYY-MM-DD (hora local); vacío = hoy
  p_producto    TEXT DEFAULT NULL    -- filtra por producto (slug o nombre aproximado)
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_sede  sedes%ROWTYPE;
  v_tz    TEXT := pd_zona(p_ws);
  v_fecha DATE;
  v_filtro TEXT := NULLIF(cat_slug(p_producto), '');
BEGIN
  SELECT * INTO v_sede FROM sedes
   WHERE workspace_id = p_ws AND activa AND lower(codigo) = lower(btrim(p_sede_codigo));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SEDE_NO_EXISTE',
      'sedes', (SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre))
                FROM sedes WHERE workspace_id = p_ws AND activa));
  END IF;

  BEGIN
    v_fecha := COALESCE(NULLIF(btrim(p_fecha), '')::date, (now() AT TIME ZONE v_tz)::date);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FECHA_INVALIDA', 'formato', 'YYYY-MM-DD');
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'sede', v_sede.nombre,
    'sede_codigo', v_sede.codigo,
    'fecha', v_fecha,
    'menu_cargado', EXISTS (SELECT 1 FROM disponibilidad_sede d
                              JOIN producto_variantes v ON v.id = d.variante_id
                              JOIN productos p ON p.id = v.producto_id AND p.modo_disponibilidad = 'por_dia'
                             WHERE d.workspace_id = p_ws AND d.sede_id = v_sede.id AND d.fecha = v_fecha),
    -- Productos del día: solo lo que el equipo cargó como disponible y con unidades
    'menu_del_dia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'linea', p.slug, 'producto', p.nombre,
               'sabor', v.opciones->>'sabor', 'tamano', v.opciones->>'tamano',
               'precio', v.precio, 'cantidad', d.cantidad)
             ORDER BY p.orden, p.nombre, v.orden, v.precio)
        FROM disponibilidad_sede d
        JOIN producto_variantes v ON v.id = d.variante_id AND v.activa
        JOIN productos p ON p.id = v.producto_id AND p.activo AND p.modo_disponibilidad = 'por_dia'
       WHERE d.workspace_id = p_ws AND d.sede_id = v_sede.id AND d.fecha = v_fecha
         AND d.disponible AND COALESCE(d.cantidad, 1) > 0
         AND (v_filtro IS NULL OR p.slug LIKE '%' || v_filtro || '%'
              OR cat_slug(p.nombre) LIKE '%' || v_filtro || '%')), '[]'::jsonb),
    -- Productos de siempre que la sede marcó agotados (o sin unidades) ese día
    'agotados_ese_dia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'linea', p.slug, 'producto', p.nombre,
               'sabor', v.opciones->>'sabor', 'tamano', v.opciones->>'tamano')
             ORDER BY p.orden, p.nombre, v.orden)
        FROM disponibilidad_sede d
        JOIN producto_variantes v ON v.id = d.variante_id AND v.activa
        JOIN productos p ON p.id = v.producto_id AND p.activo AND p.modo_disponibilidad = 'siempre'
       WHERE d.workspace_id = p_ws AND d.sede_id = v_sede.id AND d.fecha = v_fecha
         AND (NOT d.disponible OR d.cantidad = 0)
         AND (v_filtro IS NULL OR p.slug LIKE '%' || v_filtro || '%'
              OR cat_slug(p.nombre) LIKE '%' || v_filtro || '%')), '[]'::jsonb),
    -- Siempre disponibles y por encargo: solo los nombres (los precios, con cotizar_producto)
    'siempre_disponibles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('linea', slug, 'producto', nombre) ORDER BY orden, nombre)
        FROM productos
       WHERE workspace_id = p_ws AND activo AND modo_disponibilidad = 'siempre'
         AND (v_filtro IS NULL OR slug LIKE '%' || v_filtro || '%'
              OR cat_slug(nombre) LIKE '%' || v_filtro || '%')), '[]'::jsonb),
    'por_encargo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('linea', slug, 'producto', nombre) ORDER BY orden, nombre)
        FROM productos
       WHERE workspace_id = p_ws AND activo AND modo_disponibilidad = 'bajo_pedido'
         AND (v_filtro IS NULL OR slug LIKE '%' || v_filtro || '%'
              OR cat_slug(nombre) LIKE '%' || v_filtro || '%')), '[]'::jsonb)
  );
END;
$$;

-- ------------------------------------------------------------
-- 9. pd_registrar_pedido: modo de disponibilidad y descuento del menú
--    Igual a 20261005000000 salvo:
--      · "personalizado" = producto bajo_pedido (antes: línea ponque_personalizado)
--      · menú del día: por_dia exige estar cargado; por_dia y siempre se
--        rechazan si están agotados y descuentan la cantidad si la tiene
--      · guarda variante_id y las unidades descontadas (para devolverlas al cancelar)
-- ------------------------------------------------------------
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
-- 10. pd_cancelar_pedido: devuelve al menú del día lo que se descontó
--     Igual a 20261003000000 más la devolución de unidades.
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
    'vence_at', CASE WHEN v_saldo_id IS NOT NULL THEN v_vence END,
    'unidades_devueltas', v_ped.disponibilidad_descontada
  );
END;
$$;

-- ------------------------------------------------------------
-- 11. Seguridad
-- ------------------------------------------------------------
ALTER TABLE public.productos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_variantes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disponibilidad_sede ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['productos', 'producto_variantes', 'disponibilidad_sede'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                    USING (workspace_id IN (SELECT auth_workspace_ids()))', t || '_select', t);
  END LOOP;
END $$;

-- Catálogo: lo editan admin y manager
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['productos', 'producto_variantes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated
                    USING (auth_has_role(workspace_id, ARRAY[''admin'',''manager'']::workspace_role[]))
                    WITH CHECK (auth_has_role(workspace_id, ARRAY[''admin'',''manager'']::workspace_role[]))',
                   t || '_write', t);
  END LOOP;
END $$;

-- Menú del día: también el personal de las sedes (rol agent)
DROP POLICY IF EXISTS disponibilidad_sede_write ON public.disponibilidad_sede;
CREATE POLICY disponibilidad_sede_write ON public.disponibilidad_sede FOR ALL TO authenticated
  USING (auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[]))
  WITH CHECK (auth_has_role(workspace_id, ARRAY['admin','manager','agent']::workspace_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.productos, public.producto_variantes, public.disponibilidad_sede TO authenticated;
GRANT ALL ON public.productos, public.producto_variantes, public.disponibilidad_sede TO service_role;

REVOKE ALL ON FUNCTION public.cat_upsert_tarifa(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cat_upsert_tarifa(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cat_slug(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cat_vendibles(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cat_vendibles(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cat_nombre_variante(JSONB) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_disponibilidad_variante(UUID, UUID, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_disponibilidad_variante(UUID, UUID, UUID, DATE) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_consultar_disponibilidad(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_consultar_disponibilidad(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_cotizar(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_cotizar(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pd_registrar_pedido(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.pd_cancelar_pedido(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_cancelar_pedido(UUID, BOOLEAN, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 12. Catálogo de herramientas
-- ------------------------------------------------------------
INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('consultar_disponibilidad', 'Consultar disponibilidad',
   'Qué productos hay en una sede para una fecha: menú del día con cantidades, siempre disponibles y por encargo',
   '{"type":"object","properties":{"sede":{"type":"string"},"fecha":{"type":"string"},"producto":{"type":"string"}},"required":["sede"]}',
   'read')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      schema = EXCLUDED.schema, sensitivity = EXCLUDED.sensitivity;

UPDATE public.tools SET description = 'Precio, anticipo y saldo desde el catálogo de productos del negocio'
 WHERE key = 'cotizar_producto';

-- ============================================================
-- End of migration: 20261009000000_catalogo_productos
-- ============================================================
