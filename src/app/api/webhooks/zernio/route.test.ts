import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, mock } from "node:test";
import { NextRequest } from "next/server";

// POST /api/webhooks/zernio — firma, enrutamiento por cuenta y qué se hace con
// cada evento.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
process.env.ZERNIO_WEBHOOK_SECRET = "zsecret";

type Ws = { workspaceId: string; enabled: boolean; config: Record<string, unknown> } | null;
let routed: Ws = { workspaceId: "ws_1", enabled: true, config: { buffer_silence_seconds: 20 } };
const routeArgs: Array<[string | null, string | null]> = [];
const accountEvents: unknown[] = [];
mock.module("@/features/inbox/services/zernio-accounts.ts", {
  exports: {
    findZernioWorkspace: async (_db: unknown, accountId: string | null, profileId: string | null) => {
      routeArgs.push([accountId, profileId]);
      return routed;
    },
    applyAccountEvent: async (_db: unknown, ws: string, _cfg: unknown, ev: unknown) => {
      accountEvents.push({ ws, ev });
    },
  },
});

const statusCalls: unknown[] = [];
mock.module("@/features/inbox/services/message-status.ts", {
  exports: {
    applyMessageStatus: async (_db: unknown, ws: string, ev: unknown) => {
      statusCalls.push({ ws, ev });
    },
  },
});

const inbound: unknown[] = [];
const echoes: unknown[] = [];
mock.module("@/features/inbox/services/normalizer.ts", {
  exports: {
    processInbound: async (ws: string, n: unknown) => {
      inbound.push({ ws, n });
      return {
        contact: { id: "c1" },
        conversation: { id: "conv1", ai_enabled: false },
        message: { id: "msg1" },
      };
    },
    processOutboundEcho: async (ws: string, e: unknown) => {
      echoes.push({ ws, e });
      return { conversationId: "conv1", inserted: true, aiDisabled: true };
    },
  },
});
const unused = async () => {
  throw new Error("not expected in this test");
};
mock.module("@/features/inbox/services/cost-tracker.ts", { exports: { checkRateLimits: unused } });
mock.module("@/features/inbox/services/buffer.ts", {
  exports: { upsertBatch: unused, processNextBatch: unused, hasTimeToClaim: () => true },
});
mock.module("@/features/inbox/services/media-handler.ts", {
  exports: { downloadAndStoreMedia: unused, patchMessageMedia: unused },
});
mock.module("@/features/inbox/services/media-understanding.ts", {
  exports: { transcribeAudio: unused, describeImage: unused },
});
const templateUpdates: unknown[] = [];
const fakeSvc = {
  from: () => ({
    update: (patch: unknown) => {
      templateUpdates.push(patch);
      const q: { eq: () => typeof q } = { eq: () => q };
      return q;
    },
  }),
};
mock.module("@supabase/supabase-js", { exports: { createClient: () => fakeSvc } });

const { POST } = await import("./route.ts");

function post(payload: unknown, secret = "zsecret") {
  const body = JSON.stringify(payload);
  return POST(
    new NextRequest("http://localhost/api/webhooks/zernio", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "X-Zernio-Signature": createHmac("sha256", secret).update(body).digest("hex"),
      },
    }),
  );
}

function reset(ws: Ws = { workspaceId: "ws_1", enabled: true, config: {} }) {
  routed = ws;
  routeArgs.length = 0;
  accountEvents.length = 0;
  statusCalls.length = 0;
  inbound.length = 0;
  echoes.length = 0;
  templateUpdates.length = 0;
}

const account = { id: "acc_ig", accountId: "acc_ig", profileId: "prof_1", platform: "instagram", username: "golosita" };
const igMessage = {
  id: "evt_1",
  event: "message.received",
  message: {
    id: "m1",
    conversationId: "conv_z",
    platform: "instagram",
    platformMessageId: "mid.1",
    direction: "incoming",
    text: "¿tienen red velvet?",
    attachments: [],
    sender: { id: "1784", name: "Ana" },
    sentAt: "2026-10-01T15:00:00Z",
    isRead: false,
  },
  conversation: { id: "conv_z", participantId: "1784", status: "active" },
  account,
};

test("firma inválida o ausente → 401 sin tocar nada", async () => {
  reset();
  assert.equal((await post(igMessage, "otro")).status, 401);
  assert.equal(routeArgs.length, 0);
});

test("mensaje de Instagram: se enruta por cuenta y perfil y se guarda con su canal", async () => {
  reset();
  const res = await post(igMessage);
  assert.equal(res.status, 200);
  assert.deepEqual(routeArgs, [["acc_ig", "prof_1"]]);
  const { ws, n } = inbound[0] as { ws: string; n: Record<string, unknown> };
  assert.equal(ws, "ws_1");
  assert.equal(n.channel, "instagram");
  assert.equal(n.from, "ig:1784");
  assert.equal(n.externalConversationId, "conv_z");
  assert.equal(n.externalAccountId, "acc_ig");
  assert.deepEqual(await res.json(), { received: true, ai: false });
});

test("cuenta sin workspace → 200 sin procesar (Zernio no reintenta)", async () => {
  reset(null);
  const res = await post(igMessage);
  assert.equal(res.status, 200);
  assert.equal(inbound.length, 0);
});

test("Zernio conectado pero no activo: no se procesan mensajes", async () => {
  reset({ workspaceId: "ws_1", enabled: false, config: {} });
  const res = await post(igMessage);
  assert.deepEqual(await res.json(), { received: true, active: false });
  assert.equal(inbound.length, 0);
});

test("eventos de cuenta se aplican aunque Zernio no esté activo", async () => {
  reset({ workspaceId: "ws_1", enabled: false, config: {} });
  await post({ event: "account.connected", account: { accountId: "acc_fb", profileId: "prof_1", platform: "facebook", username: "g" } });
  await post({ event: "account.connected", account: { accountId: "acc_x", profileId: "prof_1", platform: "twitter", username: "g" } });
  assert.equal(accountEvents.length, 1, "solo WhatsApp, Instagram y Facebook");
});

test("eco de una persona → processOutboundEcho con el canal", async () => {
  reset();
  await post({
    event: "message.sent",
    message: { id: "m2", conversationId: "conv_z", platform: "instagram", platformMessageId: "mid.2", direction: "outgoing", text: "ya", attachments: [], sentVia: "human" },
    conversation: { id: "conv_z", participantId: "1784" },
    account,
  });
  const { e } = echoes[0] as { e: Record<string, unknown> };
  assert.equal(e.to, "ig:1784");
  assert.equal(e.channel, "instagram");
  assert.equal(inbound.length, 0);
});

test("estado de entrega y estado de plantilla", async () => {
  reset();
  await post({ event: "message.delivered", message: { id: "m3", platformMessageId: "wamid.3" }, account });
  assert.deepEqual(statusCalls, [
    { ws: "ws_1", ev: { wamid: "wamid.3", providerMessageId: "m3", status: "delivered", error: null } },
  ]);
  await post({
    event: "whatsapp.template.status_updated",
    account: { accountId: "acc_wa", profileId: "prof_1", platform: "whatsapp" },
    template: { templateId: "1", name: "pedido_listo", language: "es", status: "APPROVED", reason: "NONE" },
  });
  assert.equal((templateUpdates[0] as { status: string }).status, "approved");
});
