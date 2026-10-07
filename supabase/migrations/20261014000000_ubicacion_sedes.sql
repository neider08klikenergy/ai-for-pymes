-- ============================================================
-- Migration: 20261014000000_ubicacion_sedes
-- Ubicación de las sedes para enviarla por el chat.
--
--   · sedes.direccion (texto) sigue siendo la dirección principal: el
--     negocio la escribe como quiera ("casa esquinera rosada…").
--   · latitud / longitud son OPCIONALES: se marcan en el mapa del panel.
--     Con ellas, en WhatsApp sale el pin nativo; sin ellas, solo el texto.
--   · Más adelante servirán para cotizar domicilios por distancia.
--
-- pd_ubicacion_sede la usa la herramienta enviar_ubicacion_sede.
-- Idempotente.
-- ============================================================

ALTER TABLE public.sedes
  ADD COLUMN IF NOT EXISTS latitud  NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitud NUMERIC(9, 6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.sedes'::regclass AND conname = 'ck_sedes_coordenadas') THEN
    -- Las dos o ninguna, y dentro del rango válido
    ALTER TABLE public.sedes ADD CONSTRAINT ck_sedes_coordenadas CHECK (
      (latitud IS NULL AND longitud IS NULL)
      OR (latitud IS NOT NULL AND longitud IS NOT NULL
          AND latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pd_ubicacion_sede(
  p_ws          UUID,
  p_sede_codigo TEXT DEFAULT NULL   -- vacío: la única sede activa, si solo hay una
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_sede  sedes%ROWTYPE;
  v_total INTEGER;
BEGIN
  SELECT count(*) INTO v_total FROM sedes WHERE workspace_id = p_ws AND activa;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_SEDES');
  END IF;

  IF NULLIF(btrim(p_sede_codigo), '') IS NULL THEN
    IF v_total > 1 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ELIGE_SEDE',
        'sedes', (SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre,
                                                       'direccion', direccion) ORDER BY nombre)
                    FROM sedes WHERE workspace_id = p_ws AND activa));
    END IF;
    SELECT * INTO v_sede FROM sedes WHERE workspace_id = p_ws AND activa;
  ELSE
    SELECT * INTO v_sede FROM sedes
     WHERE workspace_id = p_ws AND activa
       AND (lower(codigo) = lower(btrim(p_sede_codigo))
            OR pd_sin_tildes(nombre) LIKE '%' || pd_sin_tildes(p_sede_codigo) || '%')
     ORDER BY lower(codigo) = lower(btrim(p_sede_codigo)) DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SEDE_NO_EXISTE',
        'sedes', (SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre) ORDER BY nombre)
                    FROM sedes WHERE workspace_id = p_ws AND activa));
    END IF;
  END IF;

  IF COALESCE(btrim(v_sede.direccion), '') = '' AND v_sede.latitud IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_DIRECCION', 'sede', v_sede.nombre);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'sede', v_sede.nombre,
    'sede_codigo', v_sede.codigo,
    'direccion', NULLIF(btrim(v_sede.direccion), ''),
    'telefono', v_sede.telefono,
    'latitud', v_sede.latitud,
    'longitud', v_sede.longitud
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pd_ubicacion_sede(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pd_ubicacion_sede(UUID, TEXT) TO authenticated, service_role;

INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('enviar_ubicacion_sede', 'Enviar ubicación de una sede',
   'Envía al cliente la dirección de una sede y, si está marcada en el mapa, el pin de ubicación (WhatsApp) o el enlace de Google Maps',
   '{"type":"object","properties":{"sede":{"type":"string"}}}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      schema = EXCLUDED.schema, sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20261014000000_ubicacion_sedes
-- ============================================================
