-- ============================================================
-- Control al confirmar pagos (auditoría de seguridad, 8 oct 2026)
--
-- pd_confirmar_pago sumaba al pedido cualquier monto que escribiera alguien
-- del equipo (rol agent o más), sin compararlo con nada: un error de dedo o
-- un monto inflado dejaban el pedido "pagado" sin que entrara ese dinero.
-- Ahora:
--   - no se confirma más de lo que el pedido todavía debe (MONTO_MAYOR_AL_SALDO);
--   - si el monto no coincide con el del comprobante, hace falta un motivo
--     (MOTIVO_DIFERENCIA_REQUERIDO), que queda en pagos_pedido.nota_revision
--     junto con revisado_por;
--   - el monto original del comprobante se conserva en monto_comprobante
--     (antes se sobrescribía con el confirmado).
-- Base para la validación automática con Forttu: misma función, mismas reglas.
-- ============================================================

ALTER TABLE public.pagos_pedido
  ADD COLUMN IF NOT EXISTS monto_comprobante INTEGER,
  ADD COLUMN IF NOT EXISTS nota_revision TEXT;

COMMENT ON COLUMN public.pagos_pedido.monto_comprobante IS
  'Monto que decía el comprobante antes de confirmar (monto_reportado queda con el confirmado).';
COMMENT ON COLUMN public.pagos_pedido.nota_revision IS
  'Motivo de quien confirmó un monto distinto al del comprobante.';

-- Igual que 20261017000000_herramientas_agente, más los controles del monto.
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
  v_comprobante INTEGER;
  v_nota TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
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

  -- Sin el valor del domicilio el total está incompleto: primero se fija.
  IF EXISTS (SELECT 1 FROM pedidos
              WHERE id = v_pago.pedido_id AND domicilio_origen = 'pendiente') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOMICILIO_POR_DEFINIR');
  END IF;

  v_monto := COALESCE(p_monto, v_pago.monto_reportado, v_pago.monto_esperado);
  -- Lo que dice el comprobante (o, si el bot no lo leyó, lo que se esperaba).
  v_comprobante := COALESCE(v_pago.monto_reportado, v_pago.monto_esperado);

  SELECT * INTO v_ped FROM pedidos WHERE id = v_pago.pedido_id FOR UPDATE;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MONTO_NO_VALIDO');
  END IF;
  -- No se confirma más de lo que el pedido todavía debe: evita errores de
  -- dedo (300.000 por 30.000) y saldos negativos.
  IF v_monto > v_ped.total - v_ped.pagado THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MONTO_MAYOR_AL_SALDO',
                              'saldo', v_ped.total - v_ped.pagado);
  END IF;
  -- Un monto distinto al del comprobante necesita un motivo, que queda
  -- guardado junto con quién lo confirmó.
  IF v_monto <> v_comprobante AND v_nota IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MOTIVO_DIFERENCIA_REQUERIDO',
                              'monto_comprobante', v_comprobante);
  END IF;

  UPDATE pagos_pedido SET estado = 'confirmado', revisado_por = v_uid, revisado_at = now(),
         monto_comprobante = v_pago.monto_reportado,
         nota_revision = CASE WHEN v_monto <> v_comprobante THEN v_nota END,
         monto_reportado = v_monto WHERE id = v_pago.id;
  UPDATE pedidos SET pagado = pagado + v_monto,
         estado = CASE WHEN estado IN ('pendiente_anticipo', 'por_verificar') THEN 'confirmado' ELSE estado END
   WHERE id = v_pago.pedido_id RETURNING * INTO v_ped;

  RETURN jsonb_build_object('ok', true, 'estado', 'confirmado', 'numero', v_ped.numero,
                            'pagado', v_ped.pagado, 'saldo', v_ped.saldo);
END;
$$;
