-- ============================================================
-- Migration: 20261013000000_foto_producto
-- El agente puede enviar la foto de un producto de vitrina (modo 'siempre'
-- o 'por_dia') cuando el cliente la pide. Los productos por encargo
-- ('bajo_pedido', p. ej. ponqués personalizados) NO: esas fotos (diseños)
-- las comparte una persona del equipo.
--
-- pd_foto_producto solo busca el producto y sus fotos; el envío lo hace la
-- herramienta enviar_foto_producto (src/features/tools/tools/pedidos/).
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pd_foto_producto(
  p_ws       UUID,
  p_producto TEXT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_slug  TEXT := NULLIF(cat_slug(p_producto), '');
  v_linea TEXT := pd_norm_linea(p_producto);
  v_ids   UUID[];
  v_prod  productos%ROWTYPE;
BEGIN
  IF v_slug IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FALTA_PRODUCTO');
  END IF;

  -- 1. Coincidencia exacta: código, línea normalizada o nombre
  SELECT array_agg(id) INTO v_ids FROM productos
   WHERE workspace_id = p_ws AND activo
     AND (slug IN (v_slug, v_linea) OR cat_slug(nombre) = v_slug);

  -- 2. Si no, el texto contenido en el código o el nombre
  IF v_ids IS NULL THEN
    SELECT array_agg(id) INTO v_ids FROM productos
     WHERE workspace_id = p_ws AND activo
       AND (slug LIKE '%' || v_slug || '%' OR cat_slug(nombre) LIKE '%' || v_slug || '%');
  END IF;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCTO_NO_ENCONTRADO',
      'productos_con_foto', (SELECT jsonb_agg(nombre ORDER BY orden, nombre) FROM productos
                              WHERE workspace_id = p_ws AND activo
                                AND modo_disponibilidad <> 'bajo_pedido'
                                AND jsonb_array_length(imagenes) > 0));
  END IF;
  IF cardinality(v_ids) > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VARIOS_PRODUCTOS',
      'opciones', (SELECT jsonb_agg(jsonb_build_object('linea', slug, 'producto', nombre)
                                    ORDER BY orden, nombre)
                     FROM productos WHERE id = ANY (v_ids)));
  END IF;

  SELECT * INTO v_prod FROM productos WHERE id = v_ids[1];

  IF v_prod.modo_disponibilidad = 'bajo_pedido' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PRODUCTO_POR_ENCARGO',
                              'producto', v_prod.nombre);
  END IF;
  IF jsonb_array_length(v_prod.imagenes) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_FOTO', 'producto', v_prod.nombre);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'producto', v_prod.nombre,
    'linea', v_prod.slug,
    'modo_disponibilidad', v_prod.modo_disponibilidad,
    -- Solo enlaces https: es lo único que el proveedor de WhatsApp descarga
    'imagenes', COALESCE((SELECT jsonb_agg(u ORDER BY n)
                            FROM jsonb_array_elements_text(v_prod.imagenes) WITH ORDINALITY AS t(u, n)
                           WHERE u LIKE 'https://%'), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pd_foto_producto(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_foto_producto(UUID, TEXT) TO authenticated, service_role;

INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('enviar_foto_producto', 'Enviar foto de producto',
   'Envía al cliente la foto de un producto de vitrina (menú del día o siempre disponible). Los personalizados los envía una persona',
   '{"type":"object","properties":{"producto":{"type":"string"},"cantidad":{"type":"integer"}},"required":["producto"]}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      schema = EXCLUDED.schema, sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20261013000000_foto_producto
-- ============================================================
