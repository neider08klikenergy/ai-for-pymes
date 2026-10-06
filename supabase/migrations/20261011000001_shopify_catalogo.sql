-- ============================================================
-- Migration: 20261011000001_shopify_catalogo
-- Importar productos de Shopify al catálogo del workspace.
--
-- La tabla interna manda: Shopify solo alimenta. Reglas:
--   · Producto o variante nuevos en Shopify → se crean (origen 'shopify').
--   · Existentes (mismo external_id) → se actualizan solo si nadie los
--     editó en el panel (editado_localmente = FALSE).
--   · Ya no están en Shopify (importación completa) → se desactivan, salvo
--     que se hayan editado en el panel.
--   · Precio 0 en Shopify → la variante queda inactiva y sin validar, para
--     que el agente nunca cotice $0.
--   · Nunca se fusiona con un producto creado a mano: si el código (slug)
--     ya existe, el importado queda con sufijo "_shopify".
--   · El modo de disponibilidad no viene de Shopify: los nuevos entran como
--     'siempre' y el negocio lo cambia en el panel.
--
-- Formato de p_productos (lo arma src/features/productos/lib/shopify.ts):
--   [{ external_id, handle, nombre, categoria, descripcion, imagenes: [..],
--      activo, variantes: [{ external_id, opciones: {..}, precio, sku }] }]
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cat_importar_shopify(
  p_ws        UUID,
  p_productos JSONB,
  p_completo  BOOLEAN DEFAULT TRUE   -- TRUE: lo que no venga se desactiva
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_p        JSONB;
  v_v        JSONB;
  v_prod     productos%ROWTYPE;
  v_var      producto_variantes%ROWTYPE;
  v_slug     TEXT;
  v_precio   INTEGER;
  v_ids_p    TEXT[] := '{}';
  v_ids_v    TEXT[];
  n_creados  INTEGER := 0;
  n_actual   INTEGER := 0;
  n_editados INTEGER := 0;
  n_var_new  INTEGER := 0;
  n_var_upd  INTEGER := 0;
  n_cero     INTEGER := 0;
  n_desact   INTEGER := 0;
  n_tmp      INTEGER;
BEGIN
  IF jsonb_typeof(p_productos) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORMATO_INVALIDO');
  END IF;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_productos) LOOP
    CONTINUE WHEN COALESCE(v_p->>'external_id', '') = '' OR COALESCE(btrim(v_p->>'nombre'), '') = '';
    v_ids_p := array_append(v_ids_p, v_p->>'external_id');

    SELECT * INTO v_prod FROM productos
     WHERE workspace_id = p_ws AND origen = 'shopify' AND external_id = v_p->>'external_id';

    IF NOT FOUND THEN
      v_slug := NULLIF(cat_slug(COALESCE(NULLIF(v_p->>'handle', ''), v_p->>'nombre')), '');
      v_slug := COALESCE(v_slug, 'producto');
      IF EXISTS (SELECT 1 FROM productos WHERE workspace_id = p_ws AND slug = v_slug) THEN
        v_slug := v_slug || '_shopify';
        -- Último recurso: dos handles que normalizan igual
        IF EXISTS (SELECT 1 FROM productos WHERE workspace_id = p_ws AND slug = v_slug) THEN
          v_slug := v_slug || '_' || substr(md5(v_p->>'external_id'), 1, 6);
        END IF;
      END IF;

      INSERT INTO productos (workspace_id, slug, nombre, categoria, descripcion, imagenes,
                             modo_disponibilidad, activo, origen, external_id)
      VALUES (p_ws, v_slug, btrim(v_p->>'nombre'), NULLIF(btrim(v_p->>'categoria'), ''),
              NULLIF(btrim(v_p->>'descripcion'), ''), COALESCE(v_p->'imagenes', '[]'::jsonb),
              'siempre', COALESCE((v_p->>'activo')::boolean, true), 'shopify', v_p->>'external_id')
      RETURNING * INTO v_prod;
      n_creados := n_creados + 1;
    ELSIF v_prod.editado_localmente THEN
      n_editados := n_editados + 1;
    ELSE
      UPDATE productos
         SET nombre = btrim(v_p->>'nombre'),
             categoria = NULLIF(btrim(v_p->>'categoria'), ''),
             descripcion = NULLIF(btrim(v_p->>'descripcion'), ''),
             imagenes = COALESCE(v_p->'imagenes', '[]'::jsonb),
             activo = COALESCE((v_p->>'activo')::boolean, true)
       WHERE id = v_prod.id;
      n_actual := n_actual + 1;
    END IF;

    -- Variantes
    v_ids_v := '{}';
    FOR v_v IN SELECT * FROM jsonb_array_elements(COALESCE(v_p->'variantes', '[]'::jsonb)) LOOP
      CONTINUE WHEN COALESCE(v_v->>'external_id', '') = '';
      v_ids_v := array_append(v_ids_v, v_v->>'external_id');
      v_precio := GREATEST(COALESCE(round((v_v->>'precio')::numeric)::int, 0), 0);
      IF v_precio = 0 THEN
        n_cero := n_cero + 1;
      END IF;

      SELECT * INTO v_var FROM producto_variantes
       WHERE producto_id = v_prod.id AND external_id = v_v->>'external_id';

      IF NOT FOUND THEN
        INSERT INTO producto_variantes (workspace_id, producto_id, opciones, precio, sku,
                                        external_id, validado, activa)
        VALUES (p_ws, v_prod.id, COALESCE(v_v->'opciones', '{}'::jsonb), v_precio,
                NULLIF(v_v->>'sku', ''), v_v->>'external_id',
                -- El precio de Shopify es el que el negocio publica en su web
                v_precio > 0, v_precio > 0)
        ON CONFLICT (producto_id, opciones) DO NOTHING;
        GET DIAGNOSTICS n_tmp = ROW_COUNT;
        n_var_new := n_var_new + n_tmp;
      ELSIF NOT v_var.editado_localmente THEN
        UPDATE producto_variantes
           SET opciones = COALESCE(v_v->'opciones', '{}'::jsonb),
               precio = v_precio,
               sku = NULLIF(v_v->>'sku', ''),
               validado = v_precio > 0,
               activa = v_precio > 0
         WHERE id = v_var.id
           -- Si las opciones nuevas chocan con otra variante, se deja como estaba
           AND NOT EXISTS (SELECT 1 FROM producto_variantes o
                            WHERE o.producto_id = v_prod.id AND o.id <> v_var.id
                              AND o.opciones = COALESCE(v_v->'opciones', '{}'::jsonb));
        GET DIAGNOSTICS n_tmp = ROW_COUNT;
        n_var_upd := n_var_upd + n_tmp;
      END IF;
    END LOOP;

    -- Variantes que ya no están en Shopify
    IF p_completo THEN
      UPDATE producto_variantes
         SET activa = false
       WHERE producto_id = v_prod.id AND external_id IS NOT NULL
         AND NOT (external_id = ANY (v_ids_v)) AND NOT editado_localmente AND activa;
    END IF;
  END LOOP;

  -- Productos que ya no están en Shopify. Una respuesta vacía no desactiva
  -- nada: es más probable un error de lectura que una tienda sin productos.
  IF p_completo AND cardinality(v_ids_p) > 0 THEN
    UPDATE productos
       SET activo = false
     WHERE workspace_id = p_ws AND origen = 'shopify'
       AND NOT (external_id = ANY (v_ids_p)) AND NOT editado_localmente AND activo;
    GET DIAGNOSTICS n_desact = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'productos_recibidos', cardinality(v_ids_p),
    'creados', n_creados,
    'actualizados', n_actual,
    'sin_tocar_por_edicion', n_editados,
    'variantes_creadas', n_var_new,
    'variantes_actualizadas', n_var_upd,
    'variantes_precio_cero', n_cero,
    'desactivados', n_desact
  );
END;
$$;

-- Solo el servidor (después de revisar el rol del usuario) importa
REVOKE ALL ON FUNCTION public.cat_importar_shopify(UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cat_importar_shopify(UUID, JSONB, BOOLEAN) TO service_role;

-- ============================================================
-- End of migration: 20261011000001_shopify_catalogo
-- ============================================================
