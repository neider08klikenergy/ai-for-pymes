import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  contactKeyFor,
  isSocialContactKey,
  parseZernioAccountEvent,
  parseZernioEcho,
  parseZernioInbound,
  parseZernioStatus,
  parseZernioTemplateStatus,
  verifyZernioSignature,
  zernioEventAccountId,
} from "./zernio-webhook-handler.ts";

const account = { id: "acc_ig", accountId: "acc_ig", profileId: "prof_1", platform: "instagram", username: "golosita" };

function received(message: Record<string, unknown>, acc: Record<string, unknown> = account) {
  return {
    id: "evt_1",
    event: "message.received",
    timestamp: "2026-10-01T15:00:00Z",
    message: {
      id: "m_int_1",
      conversationId: "conv_z_1",
      platform: "instagram",
      platformMessageId: "mid.1",
      direction: "incoming",
      text: "hola",
      attachments: [],
      sender: { id: "17841400000001", name: "Ana Pérez", username: "ana.p" },
      sentAt: "2026-10-01T15:00:00Z",
      isRead: false,
      ...message,
    },
    conversation: { id: "conv_z_1", platformConversationId: "17841400000001", participantId: "17841400000001", status: "active" },
    account: acc,
  };
}

test("firma: HMAC-SHA256 hex del cuerpo crudo", () => {
  const body = JSON.stringify({ a: 1 });
  const sig = createHmac("sha256", "s3cr3t").update(body).digest("hex");
  assert.equal(verifyZernioSignature(body, sig, "s3cr3t"), true);
  assert.equal(verifyZernioSignature(body, sig.toUpperCase(), "s3cr3t"), true);
  assert.equal(verifyZernioSignature(body + " ", sig, "s3cr3t"), false);
  assert.equal(verifyZernioSignature(body, sig, "otro"), false);
  assert.equal(verifyZernioSignature(body, null, "s3cr3t"), false);
  assert.equal(verifyZernioSignature(body, "zz", "s3cr3t"), false);
  assert.equal(verifyZernioSignature(body, sig, ""), false, "sin secreto no se acepta nada");
});

test("claves de contacto: WhatsApp usa el número; Instagram y Facebook, su id con prefijo", () => {
  assert.equal(contactKeyFor("whatsapp", "+57 310 320 8950"), "+573103208950");
  assert.equal(contactKeyFor("instagram", "1784"), "ig:1784");
  assert.equal(contactKeyFor("facebook", "99"), "fb:99");
  assert.equal(isSocialContactKey("ig:1"), true);
  assert.equal(isSocialContactKey("+573001112233"), false);
});

test("mensaje de Instagram: canal, clave, nombre e ids de Zernio", () => {
  const n = parseZernioInbound(received({}))!;
  assert.equal(n.channel, "instagram");
  assert.equal(n.from, "ig:17841400000001");
  assert.equal(n.type, "text");
  assert.equal(n.text, "hola");
  assert.equal(n.wamid, "mid.1");
  assert.equal(n.customerName, "Ana Pérez");
  assert.equal(n.externalConversationId, "conv_z_1");
  assert.equal(n.externalAccountId, "acc_ig");
  assert.equal(n.profileId, "prof_1");
  assert.equal(n.media, null);
});

test("WhatsApp: el contacto es el número del remitente", () => {
  const n = parseZernioInbound(
    received(
      { platform: "whatsapp", platformMessageId: "wamid.X", sender: { id: "x", phoneNumber: "573103208950", name: "Neider" } },
      { id: "acc_wa", platform: "whatsapp", username: "+57 310" },
    ),
  )!;
  assert.equal(n.channel, "whatsapp");
  assert.equal(n.from, "573103208950");
  assert.equal(n.wamid, "wamid.X");
  assert.equal(n.externalAccountId, "acc_wa", "account.id sirve si falta accountId");
});

test("imagen: tipo image, texto [Multimedia] y el adjunto para descargar", () => {
  const n = parseZernioInbound(
    received({ text: null, attachments: [{ type: "image", url: "https://scontent.cdninstagram.com/x.jpg", mimeType: "image/jpeg" }] }),
  )!;
  assert.equal(n.type, "image");
  assert.equal(n.text, "[Multimedia]");
  assert.deepEqual(n.media, { url: "https://scontent.cdninstagram.com/x.jpg", mime: "image/jpeg", filename: null, index: 0 });
});

test("archivo → document; mención en historia → texto descriptivo", () => {
  const doc = parseZernioInbound(received({ text: "comprobante", attachments: [{ type: "file", url: "https://zernio.com/api/v1/whatsapp/media/1" }] }))!;
  assert.equal(doc.type, "document");
  assert.equal(doc.text, "comprobante");
  const story = parseZernioInbound(received({ text: null, attachments: [{ type: "share", originalType: "story_mention", url: "https://x.fbcdn.net/a" }] }))!;
  assert.equal(story.type, "text");
  assert.match(story.text!, /historia/);
  assert.equal(story.media, null);
  assert.equal(story.rawType, "story_mention");
});

test("se ignoran: mensajes salientes, otros eventos, plataformas no soportadas y payloads incompletos", () => {
  assert.equal(parseZernioInbound(received({ direction: "outgoing" })), null);
  assert.equal(parseZernioInbound({ ...received({}), event: "message.sent" }), null);
  assert.equal(parseZernioInbound(received({ platform: "twitter" }, { id: "a", platform: "twitter" })), null);
  assert.equal(parseZernioInbound(received({ platformMessageId: null, id: null })), null);
  assert.equal(parseZernioInbound("nada"), null);
});

function sent(message: Record<string, unknown>) {
  return {
    id: "evt_2",
    event: "message.sent",
    message: {
      id: "m_out",
      conversationId: "conv_z_1",
      platform: "instagram",
      platformMessageId: "mid.out",
      direction: "outgoing",
      text: "ya te confirmo",
      attachments: [],
      sender: { id: "acc_ig" },
      sentAt: "2026-10-01T15:05:00Z",
      isRead: false,
      sentVia: null,
      ...message,
    },
    conversation: { id: "conv_z_1", platformConversationId: "1784", participantId: "1784", status: "active" },
    account,
  };
}

test("eco: una persona respondió fuera de la app (bandeja de Zernio, app de WhatsApp o de Instagram)", () => {
  const human = parseZernioEcho(sent({ sentVia: "human" }))!;
  assert.equal(human.to, "ig:1784");
  assert.equal(human.wamid, "mid.out");
  assert.equal(parseZernioEcho(sent({}))!.channel, "instagram", "IG sin sentVia = app nativa");
  const wa = parseZernioEcho({
    ...sent({ platform: "whatsapp", source: "whatsapp_business_app" }),
    conversation: { id: "c", participantId: "573001112233" },
    account: { id: "acc_wa", platform: "whatsapp" },
  })!;
  assert.equal(wa.to, "573001112233");
});

test("eco: nuestros envíos por API no son eco", () => {
  assert.equal(parseZernioEcho(sent({ sentVia: "api" })), null);
  assert.equal(parseZernioEcho(sent({ platform: "whatsapp", sentVia: null, source: "cloud_api" })), null);
  assert.equal(parseZernioEcho(sent({ sentVia: "broadcast" })), null);
});

test("estados: delivered/read/failed con los dos ids y el error de Meta", () => {
  const ok = parseZernioStatus({ event: "message.read", message: { id: "m1", platformMessageId: "wamid.1" }, account })!;
  assert.deepEqual(ok, { wamid: "wamid.1", providerMessageId: "m1", status: "read", error: null });
  const failed = parseZernioStatus({
    event: "message.failed",
    message: { id: "m2", platformMessageId: "wamid.2" },
    error: { code: 131047, title: "Re-engagement message", message: "More than 24 hours" },
  })!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error?.code, 131047);
  assert.equal(parseZernioStatus({ event: "message.sent", message: {} }), null);
});

test("cuentas y plantillas", () => {
  const conn = parseZernioAccountEvent({
    event: "account.connected",
    account: { accountId: "acc_fb", profileId: "prof_1", platform: "facebook", username: "golosita", displayName: "Golosita" },
  })!;
  assert.deepEqual(conn, {
    kind: "connected",
    accountId: "acc_fb",
    profileId: "prof_1",
    platform: "facebook",
    username: "golosita",
    displayName: "Golosita",
  });
  assert.equal(parseZernioAccountEvent({ event: "account.disconnected", account: { id: "x" } })!.kind, "disconnected");
  const tpl = parseZernioTemplateStatus({
    event: "whatsapp.template.status_updated",
    account: { accountId: "acc_wa", profileId: "prof_1", platform: "whatsapp" },
    template: { templateId: "1", name: "pedido_listo", language: "es", status: "APPROVED", reason: "NONE" },
  })!;
  assert.equal(tpl.name, "pedido_listo");
  assert.equal(tpl.status, "APPROVED");
  assert.equal(zernioEventAccountId({ account: { accountId: "a1", id: "a2" } }), "a1");
});
