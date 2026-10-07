import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

type Rpc = { ok: boolean; output: unknown; error?: string };
let rpcRespuesta: Rpc;
mock.module("./rpc.ts", {
  exports: { callPedidosRpc: async () => rpcRespuesta },
});

const pines: Record<string, unknown>[] = [];
const textos: Record<string, unknown>[] = [];
let resultado: { ok: boolean; errorCode?: string } = { ok: true };
mock.module("@/features/inbox/services/dispatch.ts", {
  exports: {
    dispatchLocation: async (p: Record<string, unknown>) => {
      pines.push(p);
      return resultado;
    },
    dispatchText: async (p: Record<string, unknown>) => {
      textos.push(p);
      return resultado;
    },
  },
});

let recientes: { id: string }[] = [];
const cadena: any = {
  select: () => cadena,
  eq: () => cadena,
  gte: () => cadena,
  limit: async () => ({ data: recientes, error: null }),
};
mock.module("@supabase/supabase-js", {
  exports: { createClient: () => ({ from: () => cadena }) },
});

const { enviarUbicacionSedeTool } = await import("./enviar-ubicacion-sede.ts");
const ctx = { workspaceId: "ws_1", conversationId: "conv_1", contactId: "c_1" };
const CAUDAL = { ok: true, sede: "Golosita Caudal", sede_codigo: "caudal", direccion: "Calle 45 # 31-08" };

beforeEach(() => {
  pines.length = 0;
  textos.length = 0;
  recientes = [];
  resultado = { ok: true };
});

test("con coordenadas envía el pin, con el texto y la sede en meta", async () => {
  rpcRespuesta = { ok: true, output: { ...CAUDAL, latitud: "4.142000", longitud: "-73.626000" } };
  const r = await enviarUbicacionSedeTool.run({ sede: "caudal" }, ctx);
  assert.equal(r.ok, true);
  assert.equal(pines.length, 1);
  assert.equal(textos.length, 0);
  assert.equal(pines[0].latitude, 4.142);
  assert.equal(pines[0].name, "Golosita Caudal");
  assert.match(String(pines[0].text), /google\.com\/maps/);
  assert.deepEqual(pines[0].meta, { ubicacion_sede: "caudal" });
});

test("sin coordenadas envía solo la dirección en texto", async () => {
  rpcRespuesta = { ok: true, output: { ...CAUDAL, latitud: null, longitud: null } };
  await enviarUbicacionSedeTool.run({ sede: "caudal" }, ctx);
  assert.equal(pines.length, 0);
  assert.equal(textos[0].body, "📍 *Golosita Caudal*\nCalle 45 # 31-08");
});

test("no repite la ubicación enviada hace poco", async () => {
  rpcRespuesta = { ok: true, output: { ...CAUDAL, latitud: null, longitud: null } };
  recientes = [{ id: "m1" }];
  const r = await enviarUbicacionSedeTool.run({ sede: "caudal" }, ctx);
  assert.equal(r.ok, true);
  assert.equal(textos.length + pines.length, 0);
});

test("ELIGE_SEDE pasa tal cual para que el agente pregunte", async () => {
  rpcRespuesta = { ok: false, output: { error: "ELIGE_SEDE" }, error: "ELIGE_SEDE" };
  const r = await enviarUbicacionSedeTool.run({}, ctx);
  assert.equal(r.error, "ELIGE_SEDE");
  assert.equal(textos.length + pines.length, 0);
});

test("si el envío falla, le devuelve la dirección al agente para que la escriba", async () => {
  rpcRespuesta = { ok: true, output: { ...CAUDAL, latitud: null, longitud: null } };
  resultado = { ok: false, errorCode: "SEND_FAILED" };
  const r = await enviarUbicacionSedeTool.run({ sede: "caudal" }, ctx);
  assert.equal(r.ok, false);
  assert.equal((r.output as { direccion: string }).direccion, "Calle 45 # 31-08");
});
