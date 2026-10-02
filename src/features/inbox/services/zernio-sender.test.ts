import assert from "node:assert/strict";
import { test } from "node:test";

// Envíos por Zernio: por conversación (Instagram, Facebook y WhatsApp), o por
// número cuando WhatsApp aún no tiene conversación en Zernio.

process.env.ZERNIO_API_KEY = "sk_test";

type Call = { url: string; method: string; body: Record<string, unknown>; auth: string | null };
const calls: Call[] = [];
let reply: unknown = { success: true, data: { messageId: "wamid.OK", conversationId: "conv_new" } };
let status = 200;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  calls.push({
    url: String(input),
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : {},
    auth: headers.get("authorization"),
  });
  return new Response(JSON.stringify(reply), { status });
}) as typeof fetch;

const { whatsappSender } = await import("./whatsapp-sender.ts");
const { ZernioError } = await import("./zernio-client.ts");

const config = { profile_id: "prof_1", accounts: [{ id: "acc_wa", platform: "whatsapp" }] };

function reset() {
  calls.length = 0;
  reply = { success: true, data: { messageId: "wamid.OK", conversationId: "conv_new" } };
  status = 200;
}

test("responde en la conversación de Instagram con su cuenta", async () => {
  reset();
  const sender = whatsappSender("zernio", {}, config);
  assert.equal(sender.live, true);
  const sent = await sender.sendText("ig:1784", "hola", {
    channel: "instagram",
    externalConversationId: "conv_ig",
    externalAccountId: "acc_ig",
  });
  assert.equal(sent.wamid, "wamid.OK");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/inbox\/conversations\/conv_ig\/messages$/);
  assert.deepEqual(calls[0].body, { accountId: "acc_ig", message: "hola" });
  assert.equal(calls[0].auth, "Bearer sk_test");
});

test("WhatsApp sin conversación en Zernio: escribe al número y recuerda la conversación", async () => {
  reset();
  const sender = whatsappSender("zernio", {}, config);
  const sent = await sender.sendText("+573103208950", "hola", {
    channel: "whatsapp",
    externalConversationId: null,
    externalAccountId: null,
  });
  assert.match(calls[0].url, /\/api\/v1\/inbox\/conversations$/);
  assert.deepEqual(calls[0].body, { accountId: "acc_wa", participantId: "573103208950", message: "hola" });
  assert.equal(sent.externalConversationId, "conv_new");
});

test("plantilla de WhatsApp en la conversación existente", async () => {
  reset();
  const sender = whatsappSender("zernio", {}, config);
  await sender.sendTemplate({
    to: "+573103208950",
    templateName: "pedido_listo",
    language: "es",
    components: [{ type: "body", parameters: [{ type: "text", text: "Neider" }] }],
    target: { channel: "whatsapp", externalConversationId: "conv_wa", externalAccountId: "acc_wa" },
  });
  assert.deepEqual(calls[0].body, {
    accountId: "acc_wa",
    template: {
      elements: [
        {
          name: "pedido_listo",
          language: "es",
          components: [{ type: "body", parameters: [{ type: "text", text: "Neider" }] }],
        },
      ],
    },
  });
});

test("plantilla sin conversación: por número con los parámetros del cuerpo", async () => {
  reset();
  const sender = whatsappSender("zernio", {}, config);
  await sender.sendTemplate({
    to: "573103208950",
    templateName: "pedido_listo",
    components: [{ type: "body", parameters: [{ type: "text", text: "Neider" }, { type: "text", text: "GOL-1" }] }],
  });
  assert.deepEqual(calls[0].body, {
    accountId: "acc_wa",
    participantId: "573103208950",
    templateName: "pedido_listo",
    templateLanguage: "es",
    templateParams: ["Neider", "GOL-1"],
  });
});

test("Instagram y Facebook no tienen plantillas; sin cuenta de WhatsApp se nombra lo que falta", async () => {
  reset();
  const sender = whatsappSender("zernio", {}, config);
  await assert.rejects(
    sender.sendTemplate({
      to: "fb:1",
      templateName: "x",
      target: { channel: "facebook", externalConversationId: "c", externalAccountId: "a" },
    }),
    /no tienen plantillas/,
  );
  const sinWa = whatsappSender("zernio", {}, { profile_id: "p", accounts: [] });
  await assert.rejects(sinWa.sendText("+57300", "hola"), /Conecta WhatsApp en Zernio/);
  await assert.rejects(
    sinWa.sendText("ig:1", "hola", { channel: "instagram", externalConversationId: null, externalAccountId: "acc_ig" }),
    /no tiene el id de Zernio/,
  );
  assert.equal(calls.length, 0, "no se llama a Zernio");
});

test("un error de Zernio llega con el error de Meta adentro", async () => {
  reset();
  status = 400;
  reply = { error: "Outside window", code: "platform_api_error", platformError: { code: 131047, message: "Re-engagement" } };
  const sender = whatsappSender("zernio", {}, config);
  await assert.rejects(
    sender.sendText("ig:1", "hola", { channel: "instagram", externalConversationId: "c", externalAccountId: "a" }),
    (err: unknown) => err instanceof ZernioError && err.status === 400 && err.code === "platform_api_error",
  );
});

test("imagen en la conversación existente: adjunto + pie de foto", async () => {
  reset();
  const sender = whatsappSender("zernio", {}, config);
  const sent = await sender.sendImage(
    "fb:99",
    { url: "https://cdn.test/a.jpg", caption: "Así queda la torta" },
    { channel: "facebook", externalConversationId: "conv_fb", externalAccountId: "acc_fb" },
  );
  assert.equal(sent.wamid, "wamid.OK");
  assert.match(calls[0].url, /\/api\/v1\/inbox\/conversations\/conv_fb\/messages$/);
  assert.deepEqual(calls[0].body, {
    accountId: "acc_fb",
    message: "Así queda la torta",
    attachmentUrl: "https://cdn.test/a.jpg",
    attachmentType: "image",
  });
});

test("imagen sin conversación en Zernio: pide enviar primero un texto, sin llamar a Zernio", async () => {
  reset();
  const sender = whatsappSender("zernio", {}, config);
  await assert.rejects(
    sender.sendImage("+573103208950", { url: "https://cdn.test/a.jpg" }, {
      channel: "whatsapp",
      externalConversationId: null,
      externalAccountId: null,
    }),
    /envía primero un mensaje de texto/,
  );
  assert.equal(calls.length, 0);
});
