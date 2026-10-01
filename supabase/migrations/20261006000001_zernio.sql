-- ============================================================
-- Migration: 20261006000001_zernio
-- Zernio: un proveedor para WhatsApp, Instagram y Facebook Messenger.
--
-- - Cada conversación guarda con qué conversación y cuenta de Zernio habla
--   (Zernio envía por conversación, no por teléfono).
-- - Los contactos de Instagram y Facebook no tienen teléfono: se guardan con
--   una clave del canal en `phone` ('ig:<IGSID>', 'fb:<PSID>'), que mantiene
--   la unicidad por workspace sin tocar el resto del esquema.
-- - Zernio entra en la regla "un solo proveedor de WhatsApp activo".
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS external_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS external_account_id TEXT;

COMMENT ON COLUMN public.conversations.external_conversation_id IS
  'Id de la conversación en el proveedor (Zernio). Necesario para responder en Instagram y Facebook.';
COMMENT ON COLUMN public.conversations.external_account_id IS
  'Id de la cuenta conectada del proveedor (Zernio) que recibe esta conversación.';

-- Un solo proveedor de WhatsApp activo por workspace, ahora con Zernio.
DROP INDEX IF EXISTS public.uq_integrations_one_active_whatsapp;
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrations_one_active_whatsapp
  ON public.integrations (workspace_id)
  WHERE enabled AND provider IN ('ycloud', 'kapso', 'zernio');

-- Enrutar webhooks de Zernio por cuenta: config.account_ids es un arreglo.
CREATE INDEX IF NOT EXISTS idx_integrations_zernio_accounts
  ON public.integrations USING GIN ((config -> 'account_ids'))
  WHERE provider = 'zernio';

-- Misma función que 20260927000002, con Zernio en la lista.
CREATE OR REPLACE FUNCTION public.save_whatsapp_integration(
  p_workspace_id   uuid,
  p_provider       public.integration_provider,
  p_enabled        boolean,
  p_credentials    jsonb,
  p_config         jsonb,
  p_workspace_keys text[]
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_own_config      jsonb;
  v_active_id       uuid;
  v_active_provider text;
  v_active_config   jsonb;
  v_carried         jsonb := '{}'::jsonb;
BEGIN
  IF p_provider::text NOT IN ('ycloud', 'kapso', 'zernio') THEN
    RAISE EXCEPTION 'not a WhatsApp provider: %', p_provider USING ERRCODE = '22023';
  END IF;

  PERFORM 1
     FROM public.integrations
    WHERE workspace_id = p_workspace_id
      AND provider IN ('ycloud', 'kapso', 'zernio')
    ORDER BY provider
      FOR UPDATE;

  SELECT config
    INTO v_own_config
    FROM public.integrations
   WHERE workspace_id = p_workspace_id
     AND provider = p_provider;
  v_own_config := coalesce(v_own_config, '{}'::jsonb);

  IF p_enabled THEN
    SELECT id, provider::text, config
      INTO v_active_id, v_active_provider, v_active_config
      FROM public.integrations
     WHERE workspace_id = p_workspace_id
       AND provider IN ('ycloud', 'kapso', 'zernio')
       AND provider <> p_provider
       AND enabled;

    IF v_active_id IS NOT NULL THEN
      SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        INTO v_carried
        FROM jsonb_each(coalesce(v_active_config, '{}'::jsonb))
       WHERE key = ANY (p_workspace_keys);

      v_own_config := v_own_config - coalesce(p_workspace_keys, '{}'::text[]);

      UPDATE public.integrations
         SET enabled = false, updated_at = now()
       WHERE id = v_active_id;
    END IF;
  END IF;

  INSERT INTO public.integrations
    (workspace_id, provider, enabled, credentials, config, updated_at)
  VALUES
    (p_workspace_id, p_provider, p_enabled, coalesce(p_credentials, '{}'::jsonb),
     v_own_config || v_carried || coalesce(p_config, '{}'::jsonb), now())
  ON CONFLICT (workspace_id, provider) DO UPDATE
    SET enabled     = EXCLUDED.enabled,
        credentials = EXCLUDED.credentials,
        config      = EXCLUDED.config,
        updated_at  = EXCLUDED.updated_at;

  RETURN v_active_provider;
END;
$$;

REVOKE ALL ON FUNCTION public.save_whatsapp_integration(uuid, public.integration_provider, boolean, jsonb, jsonb, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_whatsapp_integration(uuid, public.integration_provider, boolean, jsonb, jsonb, text[])
  TO service_role;

-- Pedidos que llegan por Instagram/Facebook: la clave del contacto ('ig:…',
-- 'fb:…') no es un teléfono. El agente pide el celular; si no lo da, queda vacío.
CREATE OR REPLACE FUNCTION public.pd_limpiar_telefono_social()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.telefono ~ '^(ig|fb):' THEN
    NEW.telefono := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.pedidos') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_pd_limpiar_telefono_social ON public.pedidos;
    CREATE TRIGGER trg_pd_limpiar_telefono_social
      BEFORE INSERT OR UPDATE OF telefono ON public.pedidos
      FOR EACH ROW EXECUTE FUNCTION public.pd_limpiar_telefono_social();
  END IF;
END $$;

-- ============================================================
-- End of migration: 20261006000001_zernio
-- ============================================================
