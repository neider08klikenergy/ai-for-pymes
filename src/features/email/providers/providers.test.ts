import assert from "node:assert/strict";
import { test } from "node:test";
import { sendgridProvider } from "./sendgrid.ts";
import { resendProvider } from "./resend.ts";
import { getEmailProvider } from "./index.ts";
import { EmailProviderError } from "./types.ts";

type Call = { url: string; body: Record<string, unknown>; auth: string | null };
let calls: Call[] = [];
let respond: () => Response = () => new Response(null, { status: 202, headers: { "X-Message-Id": "sg_1" } });
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push({
    url: String(url),
    body: JSON.parse(String(init?.body)),
    auth: new Headers(init?.headers).get("authorization"),
  });
  return respond();
}) as typeof fetch;

const email = {
  to: "ana@golosita.co",
  toName: "Ana",
  from: "avisos@aiforpymes.co",
  fromName: "Felrick",
  replyTo: null,
  subject: "Pedido nuevo",
  html: "<p>Hola</p>",
  text: "Hola",
  unsubscribeUrl: "https://app.test/api/email/baja?u=1",
  category: "notificacion",
  metadata: { workspace_id: "w1" },
};

test("SendGrid: forma del envío, cabeceras de baja y sin reescribir enlaces", async () => {
  calls = [];
  const r = await sendgridProvider("SG.key").send(email);
  assert.equal(r.id, "sg_1");
  assert.equal(calls[0].url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(calls[0].auth, "Bearer SG.key");
  const b = calls[0].body as Record<string, any>;
  assert.deepEqual(b.personalizations, [{ to: [{ email: "ana@golosita.co", name: "Ana" }] }]);
  assert.deepEqual(b.from, { email: "avisos@aiforpymes.co", name: "Felrick" });
  assert.equal(b.content[0].type, "text/plain");
  assert.equal(b.content[1].type, "text/html");
  assert.equal(b.headers["List-Unsubscribe"], "<https://app.test/api/email/baja?u=1>");
  assert.equal(b.tracking_settings.click_tracking.enable, false);
  assert.deepEqual(b.custom_args, { workspace_id: "w1" });
});

test("SendGrid: un error lleva el estado y el detalle", async () => {
  respond = () => new Response('{"errors":[{"message":"bad from"}]}', { status: 403 });
  await assert.rejects(sendgridProvider("k").send(email), (e: unknown) => {
    assert.ok(e instanceof EmailProviderError);
    assert.equal(e.status, 403);
    assert.match(e.message, /bad from/);
    return true;
  });
  respond = () => new Response(null, { status: 202, headers: { "X-Message-Id": "sg_1" } });
});

test("Resend: remitente con nombre y etiquetas válidas", async () => {
  calls = [];
  respond = () => new Response('{"id":"re_1"}', { status: 200 });
  const r = await resendProvider("re_key").send(email);
  assert.equal(r.id, "re_1");
  const b = calls[0].body as Record<string, any>;
  assert.equal(b.from, "Felrick <avisos@aiforpymes.co>");
  assert.deepEqual(b.to, ["ana@golosita.co"]);
  assert.deepEqual(b.tags, [
    { name: "category", value: "notificacion" },
    { name: "workspace_id", value: "w1" },
  ]);
  respond = () => new Response(null, { status: 202, headers: { "X-Message-Id": "sg_1" } });
});

test("elige proveedor por EMAIL_PROVIDER o por la key disponible", () => {
  const prev = { ...process.env };
  delete process.env.EMAIL_PROVIDER;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.RESEND_API_KEY;
  assert.equal(getEmailProvider().id, "log");
  process.env.RESEND_API_KEY = "re";
  assert.equal(getEmailProvider().id, "resend");
  process.env.SENDGRID_API_KEY = "sg";
  assert.equal(getEmailProvider().id, "sendgrid");
  process.env.EMAIL_PROVIDER = "resend";
  assert.equal(getEmailProvider().id, "resend");
  process.env.EMAIL_PROVIDER = "sendgrid";
  delete process.env.SENDGRID_API_KEY;
  assert.throws(() => getEmailProvider(), /SENDGRID_API_KEY/);
  process.env = prev;
});
