-- ============================================================
-- Plantillas de WhatsApp para pedidos (29 sep 2026)
-- Se crean como BORRADOR en Settings → Templates. Revísalas y envíalas a
-- aprobación desde ahí ("Enviar a Meta"). Meta tarda de minutos a 24 h.
--
-- Se usan solo cuando pasaron más de 24 h desde el último mensaje del
-- cliente (fuera de esa ventana WhatsApp no permite texto libre).
-- Los nombres deben quedar EXACTOS: el código los busca por nombre.
-- Generado desde src/features/pedidos/lib/plantillas.ts
-- ============================================================
DO $$
DECLARE v_ws UUID;
BEGIN
  SELECT id INTO v_ws FROM workspaces
   WHERE slug ILIKE 'golosita%' OR name ILIKE 'golosita%'
   ORDER BY created_at LIMIT 1;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'No encontré el workspace de Golosita (cambia el filtro si usas otro)';
  END IF;

  INSERT INTO templates (workspace_id, name, language, category, status, body_template, footer_text, variables)
  VALUES
    (v_ws, 'pedido_pago_confirmado', 'es', 'utility', 'draft', 'Hola {{1}}, confirmamos el pago de {{2}} de tu pedido {{3}}. La entrega quedó agendada para el {{4}} en {{5}}. Saldo pendiente: {{6}}.', 'Golosita', '[{"index":1,"example":"Neider"},{"index":2,"example":"$ 90.000"},{"index":3,"example":"GOL-00012"},{"index":4,"example":"jue, 1 de oct a las 3:00 p. m."},{"index":5,"example":"Golosita Caudal (Grama)"},{"index":6,"example":"$ 60.000"}]'::jsonb),
    (v_ws, 'pedido_pago_rechazado', 'es', 'utility', 'draft', 'Hola {{1}}, no pudimos verificar el pago de tu pedido {{2}}. Motivo: {{3}}. Por favor envíanos de nuevo el comprobante respondiendo a este mensaje.', 'Golosita', '[{"index":1,"example":"Neider"},{"index":2,"example":"GOL-00012"},{"index":3,"example":"la transferencia no aparece en la cuenta"}]'::jsonb),
    (v_ws, 'pedido_listo', 'es', 'utility', 'draft', 'Hola {{1}}, tu pedido {{2}} ya está listo para entregar en {{3}}. Saldo pendiente al momento de la entrega: {{4}}.', 'Golosita', '[{"index":1,"example":"Neider"},{"index":2,"example":"GOL-00012"},{"index":3,"example":"Golosita Caudal (Grama)"},{"index":4,"example":"$ 60.000"}]'::jsonb),
    (v_ws, 'pedido_cancelado', 'es', 'utility', 'draft', 'Hola {{1}}, tu pedido {{2}} quedó cancelado. {{3}} Si tienes alguna duda, responde a este mensaje.', 'Golosita', '[{"index":1,"example":"Neider"},{"index":2,"example":"GOL-00012"},{"index":3,"example":"Tu saldo a favor es de $ 90.000 y está vigente hasta el 29 mar 2027."}]'::jsonb),
    (v_ws, 'pedido_recordatorio', 'es', 'utility', 'draft', 'Hola {{1}}, te recordamos que tu pedido {{2}} se entrega mañana {{3}} en {{4}}. Saldo pendiente: {{5}}.', 'Golosita', '[{"index":1,"example":"Neider"},{"index":2,"example":"GOL-00012"},{"index":3,"example":"a las 3:00 p. m."},{"index":4,"example":"Golosita Caudal (Grama)"},{"index":5,"example":"$ 60.000"}]'::jsonb)
  ON CONFLICT (workspace_id, name, language) DO UPDATE
    SET body_template = EXCLUDED.body_template,
        footer_text   = EXCLUDED.footer_text,
        variables     = EXCLUDED.variables,
        updated_at    = now()
    WHERE templates.status IN ('draft', 'rejected');  -- nunca pisa una aprobada

  RAISE NOTICE 'Plantillas de pedidos listas como borrador en workspace %', v_ws;
END $$;
