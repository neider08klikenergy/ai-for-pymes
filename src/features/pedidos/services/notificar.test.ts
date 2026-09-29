import assert from "node:assert/strict";
import { test, mock } from "node:test";

const llamadas: Record<string, unknown>[] = [];
let respuesta: Record<string, unknown> = { ok: true, wamid: "w1" };
mock.module("@/features/inbox/services/dispatch.ts", {
  exports: {
    dispatchText: async (p: Record<string, unknown>) => {
      llamadas.push(p);
      return respuesta;
    },
  },
});

const { avisarCliente } = await import("./notificar.ts");

const base = { workspaceId: "ws", conversationId: "c1", userId: "u1" };

test("sin texto o sin chat no envía nada", async () => {
  llamadas.length = 0;
  assert.equal(await avisarCliente({ ...base, texto: "   " }), "sin_aviso");
  assert.equal(await avisarCliente({ ...base, conversationId: null, texto: "hola" }), "sin_chat");
  assert.equal(llamadas.length, 0);
});

test("envía como persona del equipo y deja nota si WhatsApp lo bloquea", async () => {
  llamadas.length = 0;
  respuesta = { ok: true };
  assert.equal(await avisarCliente({ ...base, texto: " Listo " }), "enviado");
  assert.equal(llamadas[0].body, "Listo");
  assert.equal(llamadas[0].senderUserId, "u1");
  assert.equal(llamadas[0].noteWhenBlocked, true);
});

test("traduce los errores de envío", async () => {
  respuesta = { ok: false, errorCode: "WINDOW_EXPIRED" };
  assert.equal(await avisarCliente({ ...base, texto: "x" }), "ventana_cerrada");
  respuesta = { ok: false, errorCode: "OPT_OUT" };
  assert.equal(await avisarCliente({ ...base, texto: "x" }), "bloqueado");
  respuesta = { ok: false, errorCode: "SEND_FAILED" };
  assert.equal(await avisarCliente({ ...base, texto: "x" }), "error");
});
