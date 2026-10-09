-- ============================================================
-- Presupuesto para audios e imágenes entrantes (auditoría run-2, 9 oct 2026)
--
-- Cada nota de voz o imagen de un cliente se transcribe o describe con
-- OpenRouter (media-understanding.ts). Esas llamadas no pasaban por el
-- presupuesto diario ni por ningún límite, y no registraban tokens: un
-- remitente podía generar gasto sin tope, que paga la plataforma.
--
-- reserve_media_understanding() cuenta, bajo un advisory lock por workspace,
-- las llamadas de media de la última hora del contacto y del workspace, y si
-- hay cupo inserta la fila 'media_understanding' que el servidor completa
-- después con los tokens reales. Esas filas entran en sum_daily_llm_tokens()
-- y una sesión no las puede insertar (events_insert).
--
-- Además, un turno del agente que falla después de que el proveedor cobró
-- (timeout, error a mitad del bucle de herramientas) no registraba tokens.
-- Ahora el servidor anota una estimación mínima en 'llm_usage_estimado',
-- que también suma al presupuesto (sin contar como turno del contacto).
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_media_understanding(
  p_workspace_id    UUID,
  p_contact_id      TEXT,
  p_contact_limit   INT,
  p_workspace_limit INT
)
RETURNS TABLE(allowed BOOLEAN, reservation_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contacto INT;
  v_workspace INT;
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':media_understanding', 0)
  );

  SELECT count(*) FILTER (WHERE payload->>'contact_id' = p_contact_id),
         count(*)
    INTO v_contacto, v_workspace
  FROM public.events
  WHERE type = 'media_understanding'
    AND workspace_id = p_workspace_id
    AND created_at >= now() - INTERVAL '1 hour';

  IF v_contacto >= p_contact_limit OR v_workspace >= p_workspace_limit THEN
    RETURN QUERY SELECT false, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.events (type, level, workspace_id, payload)
  VALUES (
    'media_understanding',
    'info',
    p_workspace_id,
    jsonb_build_object('total_tokens', 0, 'reserved', true, 'contact_id', p_contact_id)
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_media_understanding(uuid, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_media_understanding(uuid, text, int, int) TO service_role;

-- Igual que 20260928000001_sum_daily_llm_tokens, más las llamadas de media.
CREATE OR REPLACE FUNCTION public.sum_daily_llm_tokens(
  p_workspace_id UUID,
  p_day_start TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(
    CASE
      -- At most 12 digits: a longer number would overflow bigint and turn
      -- the whole sum into an error, which fails every turn of the workspace.
      WHEN payload->>'total_tokens' ~ '^[0-9]{1,12}$'
      THEN (payload->>'total_tokens')::bigint
      ELSE 0
    END
  ), 0)
  FROM public.events
  -- The agent's turns, the manager tools and the transcription/description of
  -- inbound media: everything that spends the OpenRouter key.
  WHERE type IN ('llm_usage', 'llm_usage_estimado', 'template_generate', 'agent_test_chat', 'media_understanding')
    AND workspace_id = p_workspace_id
    AND created_at >= p_day_start;
$$;

REVOKE ALL ON FUNCTION public.sum_daily_llm_tokens(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sum_daily_llm_tokens(uuid, timestamptz) TO service_role;

-- Igual que 20260928000003_restrict_budget_event_inserts, más media_understanding.
DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert" ON public.events
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT public.auth_workspace_ids())
    AND public.auth_has_role(workspace_id, ARRAY['admin','manager','agent']::public.workspace_role[])
    AND type NOT IN (
      'llm_usage', 'llm_usage_estimado', 'template_generate', 'agent_test_chat', 'media_understanding',
      'cost_alert', 'cost_cut', 'model_outside_catalog'
    )
  );
