-- ============================================================
-- Notificaciones del panel (29 sep 2026)
--
-- Avisos para el equipo dentro del panel (campana + sonido + alerta del
-- navegador). Los crea:
--   - la base de datos: pedido nuevo y comprobante por verificar (triggers)
--   - el código: conversación pasada a una persona, cliente esperando sin
--     respuesta y la IA retomando una conversación (seguimiento de 8 min)
--
-- Canales externos (correo con Resend o WhatsApp con plantilla) quedan para
-- después: leerían de esta misma tabla.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notificaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN (
                    'handoff', 'cliente_esperando', 'ia_retomo',
                    'pedido_nuevo', 'pago_por_verificar')),
  titulo          TEXT NOT NULL,
  cuerpo          TEXT,
  enlace          TEXT,           -- ruta del panel: /inbox/<id>, /pedidos?vista=pagos
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  pedido_id       UUID REFERENCES public.pedidos(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_ws_fecha
  ON public.notificaciones (workspace_id, created_at DESC);

-- Hasta dónde vio cada persona (una fila por usuario y workspace).
CREATE TABLE IF NOT EXISTS public.notificaciones_vistas (
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  visto_hasta  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id)
);

ALTER TABLE public.notificaciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones_vistas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificaciones_select ON public.notificaciones;
CREATE POLICY notificaciones_select ON public.notificaciones FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT auth_workspace_ids()));
-- Sin políticas de escritura: las crean los triggers y el servidor (service role).

DROP POLICY IF EXISTS notificaciones_vistas_propias ON public.notificaciones_vistas;
CREATE POLICY notificaciones_vistas_propias ON public.notificaciones_vistas FOR ALL TO authenticated
  USING (user_id = auth.uid() AND workspace_id IN (SELECT auth_workspace_ids()))
  WITH CHECK (user_id = auth.uid() AND workspace_id IN (SELECT auth_workspace_ids()));

-- ------------------------------------------------------------
-- Pedido nuevo registrado por el agente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notif_pedido_nuevo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zona TEXT := pd_zona(NEW.workspace_id);
BEGIN
  INSERT INTO notificaciones (workspace_id, tipo, titulo, cuerpo, enlace, conversation_id, pedido_id)
  VALUES (
    NEW.workspace_id, 'pedido_nuevo',
    'Pedido nuevo ' || NEW.numero,
    NEW.nombre_cliente || ' · ' || NEW.sabor || ' ' || NEW.tamano || ' · entrega '
      || to_char(NEW.fecha_entrega AT TIME ZONE v_zona, 'DD/MM HH24:MI'),
    '/pedidos', NEW.conversation_id, NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Un aviso nunca debe impedir que se guarde el pedido.
  RAISE WARNING 'notif_pedido_nuevo: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_pedido_nuevo ON public.pedidos;
CREATE TRIGGER trg_notif_pedido_nuevo
  AFTER INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.notif_pedido_nuevo();

-- ------------------------------------------------------------
-- Comprobante por verificar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notif_pago_por_verificar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ped pedidos%ROWTYPE;
BEGIN
  IF NEW.estado <> 'por_verificar' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_ped FROM pedidos WHERE id = NEW.pedido_id;
  INSERT INTO notificaciones (workspace_id, tipo, titulo, cuerpo, enlace, conversation_id, pedido_id)
  VALUES (
    NEW.workspace_id, 'pago_por_verificar',
    'Comprobante por verificar · ' || COALESCE(v_ped.numero, 'pedido'),
    COALESCE(v_ped.nombre_cliente, 'Cliente') || ' envió un comprobante'
      || CASE WHEN NEW.monto_reportado IS NOT NULL
              THEN ' por $' || replace(to_char(NEW.monto_reportado, 'FM999,999,999'), ',', '.') ELSE '' END
      || ' (esperado $' || replace(to_char(NEW.monto_esperado, 'FM999,999,999'), ',', '.') || ')',
    '/pedidos?vista=pagos', v_ped.conversation_id, NEW.pedido_id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notif_pago_por_verificar: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_pago_por_verificar ON public.pagos_pedido;
CREATE TRIGGER trg_notif_pago_por_verificar
  AFTER INSERT ON public.pagos_pedido
  FOR EACH ROW EXECUTE FUNCTION public.notif_pago_por_verificar();

REVOKE ALL ON FUNCTION public.notif_pedido_nuevo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notif_pago_por_verificar() FROM PUBLIC, anon, authenticated;
