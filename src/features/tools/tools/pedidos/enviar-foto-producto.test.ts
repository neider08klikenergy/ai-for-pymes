import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

type Rpc = { ok: boolean; output: unknown; error?: string };
let rpcRespuesta: Rpc;
const rpcLlamadas: unknown[][] = [];
mock.module("./rpc.ts", {
  exports: {
    callPedidosRpc: async (...args: unknown[]) => {
      rpcLlamadas.push(args);
      return rpcRespuesta;
    },
  },
});

let dispatchRespuesta: { ok: boolean; errorCode?: string; error?: string } = { ok: true };
const enviadas: { imageUrl?: string; caption?: string }[] = [];
mock.module("@/features/inbox/services/dispatch.ts", {
  exports: {
    dispatchImage: async (p: { imageUrl?: string; caption?: string }) => {
      enviadas.push(p);
      return dispatchRespuesta;
    },
  },
});

// Mensajes salientes recientes de la conversación (para no repetir fotos)
let recientes: { meta: Record<string, unknown> }[] = [];
const cadena: any = {
  select: () => cadena,
  eq: () => cadena,
  gte: async () => ({ data: recientes, error: null }),
};
mock.module("@supabase/supabase-js", {
  exports: { createClient: () => ({ from: () => cadena }) },
});

const { enviarFotoProductoTool } = await import("./enviar-foto-producto.ts");
const ctx = { workspaceId: "ws_1", conversationId: "conv_1", contactId: "c_1" };
const A = "https://x.supabase.co/storage/v1/object/public/productos-imagenes/ws_1/a.jpg";
const B = "https://cdn.shopify.com/b.jpg";

beforeEach(() => {
  rpcLlamadas.length = 0;
  enviadas.length = 0;
  recientes = [];
  dispatchRespuesta = { ok: true };
  rpcRespuesta = { ok: true, output: { ok: true, producto: "Golovesa", imagenes: [A, B] } };
});

test("envía la foto principal con el nombre del producto como pie", async () => {
  const r = await enviarFotoProductoTool.run({ producto: "golovesa" }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(rpcLlamadas[0], ["pd_foto_producto", { p_ws: "ws_1", p_producto: "golovesa" }]);
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].imageUrl, A);
  assert.equal(enviadas[0].caption, "Golovesa");
  assert.equal((r.output as { enviadas: number }).enviadas, 1);
});

test("con cantidad envía varias; solo la primera lleva pie", async () => {
  await enviarFotoProductoTool.run({ producto: "golovesa", cantidad: 3 }, ctx);
  assert.deepEqual(enviadas.map((e) => e.imageUrl), [A, B]);
  assert.equal(enviadas[1].caption, undefined);
});

test("no repite una foto enviada hace poco", async () => {
  recientes = [{ meta: { image_url: A } }];
  const r = await enviarFotoProductoTool.run({ producto: "golovesa" }, ctx);
  assert.equal(r.ok, true);
  assert.equal(enviadas.length, 0);
  assert.equal((r.output as { enviadas: number }).enviadas, 0);
});

test("un producto por encargo no envía nada y deja la guía de pasar a persona", async () => {
  rpcRespuesta = { ok: false, output: { error: "PRODUCTO_POR_ENCARGO", guia: "pasar_a_persona" }, error: "PRODUCTO_POR_ENCARGO" };
  const r = await enviarFotoProductoTool.run({ producto: "ponqué" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error, "PRODUCTO_POR_ENCARGO");
  assert.equal(enviadas.length, 0);
});

test("sin fotos https responde SIN_FOTO", async () => {
  rpcRespuesta = { ok: true, output: { ok: true, producto: "Helado", imagenes: [] } };
  const r = await enviarFotoProductoTool.run({ producto: "helado" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error, "SIN_FOTO");
});

test("fuera de la ventana de 24 h avisa que hay que pasar a una persona", async () => {
  dispatchRespuesta = { ok: false, errorCode: "WINDOW_EXPIRED", error: "x" };
  const r = await enviarFotoProductoTool.run({ producto: "golovesa" }, ctx);
  assert.equal(r.ok, false);
  assert.match((r.output as { guia: string }).guia, /24 horas/);
});

test("el esquema limita la cantidad a 3", () => {
  assert.equal(enviarFotoProductoTool.schema.safeParse({ producto: "x", cantidad: 4 }).success, false);
  assert.equal(enviarFotoProductoTool.schema.safeParse({ producto: "x", cantidad: 2 }).success, true);
});
