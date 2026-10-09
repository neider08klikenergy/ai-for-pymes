import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

// Presupuesto del día y reserva de media (lo que decide si se llama al modelo).
let politica: "allow" | "degrade" | "cut" = "allow";
mock.module("./cost-enforcer.ts", {
  exports: { enforceCostPolicy: async () => ({ policy: politica }) },
});
mock.module("./openrouter.ts", {
  exports: { getOpenRouterApiKey: async () => "key-plataforma" },
});

let cupo = true;
let bytes = new Uint8Array(10);
const reservas: Record<string, unknown>[] = [];
const usos: Record<string, unknown>[] = [];
mock.module("@supabase/supabase-js", {
  exports: {
    createClient: () => ({
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob([bytes]), error: null }),
        }),
      },
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        reservas.push(args);
        return { data: [{ allowed: cupo, reservation_id: cupo ? "res_1" : null }], error: null };
      },
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { payload: { contact_id: "c_1", reserved: true } }, error: null }),
          update: (row: Record<string, unknown>) => {
            usos.push(row);
            return chain;
          },
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
  },
});

let llamadasModelo = 0;
globalThis.fetch = (async () => {
  llamadasModelo++;
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "hola, quiero un ponqué" } }],
      usage: { prompt_tokens: 300, completion_tokens: 12 },
    }),
    { status: 200 },
  );
}) as unknown as typeof fetch;

const { transcribeAudio, MEDIA_MAX_BYTES, MEDIA_LIMITE_CONTACTO_HORA } = await import(
  "./media-understanding.ts"
);
const audio = { storagePath: "ws/conv/a.ogg", workspaceId: "ws_1", contactId: "c_1" };

function reset() {
  politica = "allow";
  cupo = true;
  bytes = new Uint8Array(10);
  reservas.length = 0;
  usos.length = 0;
  llamadasModelo = 0;
}

test("con cupo: reserva por contacto, llama al modelo y registra los tokens en el presupuesto", async () => {
  reset();
  assert.equal(await transcribeAudio(audio), "hola, quiero un ponqué");
  assert.equal(llamadasModelo, 1);
  assert.equal(reservas[0].p_contact_id, "c_1");
  assert.equal(reservas[0].p_contact_limit, MEDIA_LIMITE_CONTACTO_HORA);
  const payload = (usos[0] as { payload: Record<string, unknown> }).payload;
  assert.equal(payload.total_tokens, 312);
  assert.equal(payload.contact_id, "c_1");
});

test("sin cupo (límite por contacto o workspace): no llama al modelo", async () => {
  reset();
  cupo = false;
  assert.equal(await transcribeAudio(audio), null);
  assert.equal(llamadasModelo, 0);
});

test("con el presupuesto diario cortado: ni siquiera reserva", async () => {
  reset();
  politica = "cut";
  assert.equal(await transcribeAudio(audio), null);
  assert.equal(reservas.length, 0);
  assert.equal(llamadasModelo, 0);
});

test("un audio más grande que el máximo de WhatsApp no se manda al modelo", async () => {
  reset();
  bytes = new Uint8Array(MEDIA_MAX_BYTES.audio + 1);
  assert.equal(await transcribeAudio(audio), null);
  assert.equal(reservas.length, 0);
  assert.equal(llamadasModelo, 0);
});
