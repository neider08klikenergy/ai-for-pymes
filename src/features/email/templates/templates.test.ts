import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL_TEMPLATES } from "./index.ts";

const ctx = {
  brand: { name: "AI for PYMES", logoUrl: null, color: "#a3e635", colorText: "#1a2e05", appUrl: "https://app.test" },
  unsubscribeUrl: "https://app.test/api/email/baja?u=1&w=2&t=3",
};

test("notificación: asunto con el negocio, botón al panel y enlace de baja", () => {
  const r = EMAIL_TEMPLATES.notificacion.render(
    {
      tipo: "pedido_nuevo",
      titulo: "Pedido nuevo P-0012",
      cuerpo: "Ana · Chocolate 1 lb · entrega 05/10 15:00",
      enlace: "/pedidos",
      workspaceName: "Golosita",
    },
    ctx,
  );
  assert.equal(r.subject, "Pedido nuevo P-0012 · Golosita");
  assert.ok(r.html.includes('href="https://app.test/pedidos"'));
  assert.ok(r.html.includes("Ver pedidos"));
  assert.ok(r.html.includes("Dejar de recibir estos correos"));
  assert.match(r.text, /Ana · Chocolate 1 lb/);
});

test("cada tipo de aviso tiene su texto y botón", () => {
  for (const tipo of ["pedido_nuevo", "pago_por_verificar", "handoff", "cliente_esperando", "ia_retomo"] as const) {
    const r = EMAIL_TEMPLATES.notificacion.render(
      { tipo, titulo: "T", cuerpo: null, enlace: null, workspaceName: "W" },
      { ...ctx, unsubscribeUrl: null },
    );
    assert.ok(r.html.length > 500, tipo);
    assert.ok(!r.html.includes("Dejar de recibir"), tipo);
  }
});

test("prueba: saluda por nombre y lista los avisos elegidos", () => {
  const r = EMAIL_TEMPLATES.prueba.render(
    { nombre: "Neider", workspaceName: "Golosita", tipos: ["handoff"] },
    ctx,
  );
  assert.equal(r.subject, "Correo de prueba · Golosita");
  assert.match(r.text, /Hola Neider/);
  assert.match(r.text, /Conversación para una persona/);
});
