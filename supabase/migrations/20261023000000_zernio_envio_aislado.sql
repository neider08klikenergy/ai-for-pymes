-- ============================================================
-- Envío por Zernio aislado entre workspaces (auditoría run-3, 9 oct 2026)
--
-- Toda la plataforma envía con una sola ZERNIO_API_KEY, así que la cuenta
-- desde la que se envía tiene que ser del perfil del propio workspace.
--
-- 1. trg_integrations_guard_zernio_binding (20261016000000) solo corría con
--    NEW.provider = 'zernio' y en UPDATE comparaba config contra OLD. Un admin
--    podía crear una fila 'kapso' con config.accounts de otro negocio (sin
--    trigger) y luego cambiarle provider a 'zernio' (config igual a OLD: pasaba).
--    Ahora, si la fila no era de Zernio, el cambio cuenta como una fila nueva:
--    una sesión no puede traer esas claves.
--
-- 2. conversations.external_account_id / external_conversation_id los escribe
--    solo el servidor (webhook y envío). La RLS deja a admin/manager/asignado
--    actualizar la conversación, y el envío usaba esas columnas: con el id de
--    otro negocio se enviaba desde su cuenta. Tampoco window_expires_at: con
--    NULL se saltaba la ventana de 24 h. Una sesión ya no puede escribirlas
--    (el envío además solo acepta cuentas de config.accounts).
-- ============================================================

-- ------------------------------------------------------------
-- 1. integrations: cambiar provider a 'zernio' es una escritura nueva
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.integrations_guard_zernio_binding()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  k TEXT;
BEGIN
  -- service_role y las funciones del sistema pasan; solo se limitan las
  -- sesiones (PostgREST con la anon key + JWT del usuario).
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  FOREACH k IN ARRAY ARRAY['profile_id', 'accounts', 'account_ids'] LOOP
    IF TG_OP = 'INSERT' OR OLD.provider IS DISTINCT FROM 'zernio' THEN
      IF NEW.config ? k THEN
        RAISE EXCEPTION 'config.% de Zernio solo lo escribe el servidor', k
          USING ERRCODE = '42501';
      END IF;
    ELSIF (NEW.config -> k) IS DISTINCT FROM (OLD.config -> k) THEN
      RAISE EXCEPTION 'config.% de Zernio solo lo escribe el servidor', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- El trigger (WHEN NEW.provider = 'zernio') no cambia: corre en el INSERT y
-- en el UPDATE que deja la fila como 'zernio', que son los dos casos.

-- ------------------------------------------------------------
-- 2. conversations: columnas del proveedor solo del servidor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conversations_guard_provider_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.external_account_id IS NOT NULL
       OR NEW.external_conversation_id IS NOT NULL
       OR NEW.window_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'external_account_id, external_conversation_id y window_expires_at solo los escribe el servidor'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.external_account_id IS DISTINCT FROM OLD.external_account_id
     OR NEW.external_conversation_id IS DISTINCT FROM OLD.external_conversation_id
     OR NEW.window_expires_at IS DISTINCT FROM OLD.window_expires_at THEN
    RAISE EXCEPTION 'external_account_id, external_conversation_id y window_expires_at solo los escribe el servidor'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversations_guard_provider_columns ON public.conversations;
CREATE TRIGGER trg_conversations_guard_provider_columns
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.conversations_guard_provider_columns();
