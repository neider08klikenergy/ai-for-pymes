import assert from "node:assert/strict";
import { test } from "node:test";
import { whatsappSender } from "./whatsapp-sender.ts";

// A sender without the id it sends from must say so — before calling the
// provider, whose answer to an empty id is opaque.

let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls++;
  return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
}) as typeof fetch;

test("Kapso without phone_number_id names the missing setting", async () => {
  fetchCalls = 0;
  const sender = whatsappSender("kapso", { kapso_api_key: "kp" }, { phone_number_id: "" });
  await assert.rejects(sender.sendText("+15550001111", "hola"), /Falta el Phone Number ID de Kapso/);
  await assert.rejects(
    sender.sendTemplate({ to: "+15550001111", templateName: "t" }),
    /Falta el Phone Number ID de Kapso/,
  );
  assert.equal(fetchCalls, 0, "the provider is never called");
});

test("YCloud without its number names the missing setting", async () => {
  fetchCalls = 0;
  const sender = whatsappSender("ycloud", { ycloud_api_key: "yk" }, {});
  await assert.rejects(sender.sendText("+5215550001111", "hola"), /Falta el número de WhatsApp de YCloud/);
  assert.equal(fetchCalls, 0);
});

test("a configured Kapso sender still sends", async () => {
  fetchCalls = 0;
  const sender = whatsappSender("kapso", { kapso_api_key: "kp" }, { phone_number_id: "pn_1" });
  const sent = await sender.sendText("+15550001111", "hola");
  assert.equal(sent.wamid, "wamid.1");
  assert.equal(fetchCalls, 1);
});

test("Kapso sends an image by link with its caption", async () => {
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ messages: [{ id: "wamid.img" }] }), { status: 200 });
  }) as typeof fetch;
  const sender = whatsappSender("kapso", { kapso_api_key: "kp" }, { phone_number_id: "pn_1" });
  const sent = await sender.sendImage("+15550001111", { url: "https://cdn.test/a.jpg", caption: "Menú" });
  assert.equal(sent.wamid, "wamid.img");
  assert.deepEqual(body, {
    messaging_product: "whatsapp",
    to: "+15550001111",
    type: "image",
    image: { link: "https://cdn.test/a.jpg", caption: "Menú" },
  });
});

test("YCloud sends an image without caption when there is none", async () => {
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "yc_1", wamid: "wamid.y" }), { status: 200 });
  }) as typeof fetch;
  const sender = whatsappSender("ycloud", { ycloud_api_key: "yk" }, { phone_number: "+15550002222" });
  const sent = await sender.sendImage("+15550001111", { url: "https://cdn.test/a.png" });
  assert.equal(sent.wamid, "wamid.y");
  assert.deepEqual(body, {
    type: "image",
    from: "+15550002222",
    to: "+15550001111",
    image: { link: "https://cdn.test/a.png" },
  });
});
