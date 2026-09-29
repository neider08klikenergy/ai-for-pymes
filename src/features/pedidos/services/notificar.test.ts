import assert from "node:assert/strict";
import { test, mock } from "node:test";

const textos: Record<string, unknown>[] = [];
const plantillas: Record<string, unknown>[] = [];
let respuestaTexto: Record<string, unknown> = { ok: true, wamid: "w1" };
let respuestaPlantilla: Record<string, unknown> = { ok: true };
let aprobadas: { name: string; language: string }[] = [];

mock.module("@/features/inbox/services/dispatch.ts", {
  exports: {
    dispatchText: async (p: Record<string, unknown>) => {
      textos.push(p);
      return respuestaTexto;
    },
    dispatchTemplate: async (p: Record<string, unknown>) => {
      plantillas.push(p);
      return respuestaPlantilla;
    },
  },
});
mock.module("@/features/inbox/services/templates.ts", {
  exports: { listTemplates: async () => aprobadas },
});

const { avisarCliente } = await import("./notificar.ts");

const base = { workspaceId: "ws", conversationId: "c1", userId: "u1" };
const plantilla = { nombre: "pedido_listo", parametros: ["Neider", "GOL-1", "Caudal", "$ 0"] };

function reiniciar() {
  textos.length = 0;
  plantillas.length = 0;
  respuestaTexto = { ok: true };
  respuestaPlantilla = { ok: true };
  aprobadas = [];
}

test("sin texto o sin chat no envía nada", async () => {
  reiniciar();
  assert.equal(await avisarCliente({ ...base, texto: "   " }), "sin_aviso");
  assert.equal(await avisarCliente({ ...base, conversationId: null, texto: "hola" }), "sin_chat");
  assert.equal(textos.length, 0);
});

test("dentro de la ventana envía el texto como persona del equipo", async () => {
  reiniciar();
  assert.equal(await avisarCliente({ ...base, texto: " Listo ", plantilla }), "enviado");
  assert.equal(textos.length, 1);
  assert.equal(textos[0].body, "Listo");
  assert.equal(textos[0].senderUserId, "u1");
  assert.equal(plantillas.length, 0);
});

test("ventana cerrada + plantilla aprobada: envía la plantilla con sus variables", async () => {
  reiniciar();
  respuestaTexto = { ok: false, errorCode: "WINDOW_EXPIRED" };
  aprobadas = [{ name: "pedido_listo", language: "es" }];
  assert.equal(await avisarCliente({ ...base, texto: "x", plantilla }), "enviado_plantilla");
  assert.equal(plantillas.length, 1);
  assert.equal(plantillas[0].templateName, "pedido_listo");
  const comp = (plantillas[0].components as { parameters: { text: string }[] }[])[0];
  assert.deepEqual(comp.parameters.map((p) => p.text), plantilla.parametros);
  // No deja nota: el cliente sí recibió el aviso
  assert.equal(textos.filter((t) => t.noteWhenBlocked === true).length, 0);
});

test("ventana cerrada sin plantilla aprobada: deja la nota en el chat", async () => {
  reiniciar();
  respuestaTexto = { ok: false, errorCode: "WINDOW_EXPIRED" };
  assert.equal(await avisarCliente({ ...base, texto: "x", plantilla }), "ventana_cerrada");
  assert.equal(plantillas.length, 0);
  assert.equal(textos.at(-1)?.noteWhenBlocked, true);
});

test("traduce los demás errores", async () => {
  reiniciar();
  respuestaTexto = { ok: false, errorCode: "OPT_OUT" };
  assert.equal(await avisarCliente({ ...base, texto: "x" }), "bloqueado");
  respuestaTexto = { ok: false, errorCode: "SEND_FAILED" };
  assert.equal(await avisarCliente({ ...base, texto: "x" }), "error");
});
