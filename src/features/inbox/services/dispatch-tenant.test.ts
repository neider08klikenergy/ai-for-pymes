import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

// ── In-memory tables: two tenants on DIFFERENT WhatsApp providers ────────────
// ws_a and ws_b both talk through Kapso with their own number and key; ws_b
// also keeps a disabled Zernio row from before it switched, never used.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  conversations: [
    { id: "conv_a", workspace_id: "ws_a", contact_id: "ct_a", window_expires_at: null },
    { id: "conv_b", workspace_id: "ws_b", contact_id: "ct_b", window_expires_at: null },
  ],
  contacts: [
    { id: "ct_a", workspace_id: "ws_a", phone: "+15550000001", opt_in: true },
    { id: "ct_b", workspace_id: "ws_b", phone: "+15550000002", opt_in: true },
  ],
  integrations: [
    {
      id: "int_a",
      workspace_id: "ws_a",
      provider: "kapso",
      enabled: true,
      credentials: { kapso_api_key: "kp-key-a" },
      config: { phone_number_id: "pn_a" },
    },
    {
      id: "int_b_old",
      workspace_id: "ws_b",
      provider: "zernio",
      enabled: false,
      credentials: {},
      config: { profile_id: "prof_b_old" },
    },
    {
      id: "int_b",
      workspace_id: "ws_b",
      provider: "kapso",
      enabled: true,
      credentials: { kapso_api_key: "kp-key-b" },
      config: { phone_number_id: "pn_b" },
    },
  ],
};

let upserted: Array<{ table: string; row: Row }> = [];
tables.messages = [];
tables.events = [];
/** The messages table as dispatch left it. */
const msgs = () => tables.messages;

/** The next N UPDATEs fail. */
let failUpdates = 0;

// A PostgREST-ish fake that honors eq() on reads, updates and deletes, so a
// write scoped to the wrong row or workspace misses, as it would for real.
function query(table: string, mode: "select" | "update" | "delete" = "select", patch?: Row) {
  const filters: Array<(r: Row) => boolean> = [];
  const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const builder: any = {
    select: () => builder,
    eq(column: string, value: unknown) {
      filters.push((r) => r[column] === value);
      return builder;
    },
    in(column: string, values: unknown[]) {
      filters.push((r) => values.includes(r[column]));
      return builder;
    },
    single: async () => {
      const r = rows();
      return r.length === 1
        ? { data: r[0], error: null }
        : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
    },
    maybeSingle: async () => {
      const r = rows();
      return r.length > 1
        ? { data: null, error: { message: "multiple rows" } }
        : { data: r[0] ?? null, error: null };
    },
    then(resolve: (v: unknown) => void) {
      if (mode === "update") {
        if (failUpdates > 0) {
          failUpdates--;
          resolve({ error: { message: "update failed" } });
          return;
        }
        rows().forEach((r) => Object.assign(r, patch));
        resolve({ error: null });
      } else if (mode === "delete") {
        const hit = new Set(rows());
        tables[table] = tables[table].filter((r) => !hit.has(r));
        resolve({ error: null });
      } else {
        resolve({ data: rows(), error: null });
      }
    },
  };
  return builder;
}

const fakeClient = {
  from(table: string) {
    return {
      select: () => query(table),
      insert(row: Row) {
        const stored = { id: `row_${(tables[table] ?? []).length + 1}`, ...row };
        (tables[table] ??= []).push(stored);
        const done = { data: stored, error: null };
        return {
          select: () => ({ single: async () => done, maybeSingle: async () => done }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
      },
      upsert(row: Row) {
        upserted.push({ table, row });
        return Promise.resolve({ error: null });
      },
      update: (patch: Row) => query(table, "update", patch),
      delete: () => query(table, "delete"),
    };
  },
};

mock.module("@supabase/supabase-js", {
  exports: { createClient: () => fakeClient },
});

mock.module("@/shared/lib/integration-secrets.ts", {
  exports: { decryptCredentials: async (creds: Row) => creds ?? {} },
});

let sends: Array<Record<string, unknown>> = [];
// Set to make the next Kapso send fail the way the API does.
let sendFailure: { status: number; body: unknown } | null = null;
/** Runs inside the Kapso send, before it returns. */
let sendHook: (() => void) | null = null;
class FakeKapsoError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`Kapso API error ${status}`);
    this.status = status;
    this.body = body;
  }
}
mock.module("./kapso-client.ts", {
  exports: {
    KapsoError: FakeKapsoError,
    sendText: async (p: Record<string, unknown>) => {
      sends.push({ provider: "kapso", kind: "text", ...p });
      sendHook?.();
      if (sendFailure) throw new FakeKapsoError(sendFailure.status, sendFailure.body);
      return { id: "kp_text", wamid: "wamid_k_text" };
    },
    sendTemplate: async (p: Record<string, unknown>) => {
      sends.push({ provider: "kapso", kind: "template", ...p });
      return { id: "kp_tpl", wamid: "wamid_k_tpl" };
    },
  },
});

const { dispatchText, dispatchTemplate } = await import("./dispatch.ts");

function reset() {
  tables.messages = [];
  tables.events = [];
  upserted = [];
  sends = [];
  sendFailure = null;
  (tables.contacts[0] as Row).opt_in = true;
}

test("each workspace sends with its own number and key", async () => {
  reset();
  const res = await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola" });
  assert.equal(res.ok, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].phoneNumberId, "pn_a");
  assert.equal(sends[0].apiKey, "kp-key-a");
  assert.equal(sends[0].to, "+15550000001");
  assert.equal(msgs()[0].status, "sent");
});

test("a Kapso workspace sends through Kapso with its phone_number_id, never its old Zernio row", async () => {
  reset();
  const res = await dispatchText({ workspaceId: "ws_b", conversationId: "conv_b", body: "hola" });
  assert.equal(res.ok, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].provider, "kapso");
  assert.equal(sends[0].phoneNumberId, "pn_b");
  assert.equal(sends[0].apiKey, "kp-key-b");
  assert.equal(msgs()[0].wamid, "wamid_k_text");
});

test("templates go out per workspace too", async () => {
  reset();
  await dispatchTemplate({ workspaceId: "ws_a", conversationId: "conv_a", templateName: "welcome" });
  await dispatchTemplate({ workspaceId: "ws_b", conversationId: "conv_b", templateName: "welcome" });
  assert.deepEqual(
    sends.map((s) => [s.provider, s.kind]),
    [
      ["kapso", "template"],
      ["kapso", "template"],
    ],
  );
  assert.deepEqual(
    msgs().map((m) => m.workspace_id),
    ["ws_a", "ws_b"],
  );
});

test("a conversation from another workspace is not sent nor persisted", async () => {
  reset();
  const text = await dispatchText({ workspaceId: "ws_a", conversationId: "conv_b", body: "hola" });
  const tpl = await dispatchTemplate({ workspaceId: "ws_a", conversationId: "conv_b", templateName: "welcome" });
  assert.equal(text.errorCode, "NOT_FOUND");
  assert.equal(tpl.errorCode, "NOT_FOUND");
  assert.equal(sends.length, 0);
  assert.equal(msgs().length, 0);
});

test("an opted-out contact is not sent to", async () => {
  reset();
  (tables.contacts[0] as Row).opt_in = false;
  const res = await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola" });
  assert.equal(res.ok, false);
  assert.equal(res.errorCode, "OPT_OUT");
  assert.match(res.error ?? "", /pidió no recibir/);
  assert.equal(sends.length, 0);
  assert.equal(msgs().length, 0);
});

test("a workspace without an active WhatsApp provider fails loudly", async () => {
  reset();
  tables.conversations.push({ id: "conv_c", workspace_id: "ws_c", contact_id: "ct_c", window_expires_at: null });
  tables.contacts.push({ id: "ct_c", workspace_id: "ws_c", phone: "+15550000003", opt_in: true });
  await assert.rejects(
    () => dispatchText({ workspaceId: "ws_c", conversationId: "conv_c", body: "hola" }),
    /WhatsApp integration not found/,
  );
  assert.equal(sends.length, 0);
});

test("a template keeps its wamid and is stored as sent", async () => {
  reset();
  await dispatchTemplate({ workspaceId: "ws_a", conversationId: "conv_a", templateName: "welcome" });
  assert.equal(msgs()[0].status, "sent");
  assert.equal(msgs()[0].wamid, "wamid_k_tpl");
});

test("a failed send stores the reason in Spanish and the detail in message_errors only", async () => {
  reset();
  sendFailure = {
    status: 400,
    body: {
      error: {
        code: 131026,
        message: "Message undeliverable",
        fbtrace_id: "trace_1",
      },
    },
  };
  const res = await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola" });
  assert.equal(res.ok, false);
  assert.equal(res.errorCode, "SEND_FAILED");
  assert.equal(res.retryable, false);
  const failed = msgs()[0];
  assert.equal(failed.status, "failed");
  assert.match(String(failed.error_message), /no tenga WhatsApp/);
  // Nothing technical in the row the browser reads.
  assert.ok(!JSON.stringify(failed).includes("trace_1"));
  assert.ok(!JSON.stringify(failed).includes("undeliverable"));
  const detail = upserted.find((u) => u.table === "message_errors")?.row as Row;
  assert.equal(detail.code, 131026);
  assert.equal(detail.fbtrace_id, "trace_1");
});

test("a send WhatsApp did not accept is retryable, and the buffer can skip the failed row", async () => {
  reset();
  sendFailure = { status: 429, body: { error: { code: 130429 } } };
  const res = await dispatchText({
    workspaceId: "ws_a",
    conversationId: "conv_a",
    body: "hola",
    recordRetryableFailure: false,
    meta: { batch_id: "b_1" },
  });
  assert.equal(res.retryable, true);
  // Never deleted (open inboxes don't hear deletes): marked for the retry to skip.
  assert.equal(msgs().length, 1);
  assert.equal(msgs()[0].status, "failed");
  const meta = msgs()[0].meta as Row;
  assert.equal(meta.not_accepted, true);
  assert.equal(meta.batch_id, "b_1", "the row keeps its meta");
  assert.match(String(msgs()[0].error_message), /vuelve a intentar/);
  assert.equal(upserted.length, 0, "not a final failure: no message_errors row");

  reset();
  sendFailure = { status: 429, body: { error: { code: 130429 } } };
  await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola" });
  assert.equal(msgs().length, 1, "by default the failure is recorded");
  assert.equal(msgs()[0].status, "failed");
});

test("a not-accepted row that can't be marked is retried, then deleted — never left 'queued'", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    reset();
    failUpdates = 1;
    sendFailure = { status: 429, body: { error: { code: 130429 } } };
    await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola", recordRetryableFailure: false });
    assert.equal(msgs()[0]?.status, "failed", "the second attempt marks it");

    reset();
    failUpdates = 2;
    sendFailure = { status: 429, body: { error: { code: 130429 } } };
    await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola", recordRetryableFailure: false });
    assert.equal(msgs().length, 0, "a row still 'queued' would block the retry: deleted");
  } finally {
    console.error = original;
    failUpdates = 0;
  }
});

test("a network error may have delivered the message, so it is never retryable", async () => {
  reset();
  sendFailure = { status: 503, body: null };
  const res = await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola" });
  assert.equal(res.retryable, false);
  assert.equal(msgs().length, 1);
  assert.match(String(msgs()[0].error_message), /es posible que el mensaje sí haya llegado/);
});

test("the row is queued before the send, so a failure after it still has a row", async () => {
  reset();
  let rowsAtSend = -1;
  let statusAtSend: unknown = null;
  const originalFailure = sendFailure;
  sendFailure = null;
  sendHook = () => {
    rowsAtSend = msgs().length;
    statusAtSend = msgs()[0]?.status;
  };
  await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola" });
  sendHook = null;
  sendFailure = originalFailure;
  assert.equal(rowsAtSend, 1, "the queued row exists when the provider is called");
  assert.equal(statusAtSend, "queued", "and it is queued, not already 'sent'");
  assert.equal(msgs()[0].status, "sent");
});

test("extra meta (the buffer's batch id) lands on the outbound row", async () => {
  reset();
  await dispatchText({
    workspaceId: "ws_a",
    conversationId: "conv_a",
    body: "hola",
    meta: { batch_id: "batch_9" },
  });
  assert.equal((msgs()[0].meta as Row).batch_id, "batch_9");
});

test("a blocked AI reply leaves an internal note with its text; a person's send doesn't", async () => {
  reset();
  (tables.contacts[0] as Row).opt_in = false;
  await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "tu cita", noteWhenBlocked: true });
  assert.equal(sends.length, 0);
  assert.equal(msgs().length, 1);
  assert.equal(msgs()[0].type, "system");
  assert.equal((msgs()[0].meta as Row).internal, true);
  assert.match(String(msgs()[0].body), /tu cita/);

  reset();
  (tables.contacts[0] as Row).opt_in = false;
  await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola" });
  assert.equal(msgs().length, 0);
});

test("a reply outside the 24h window is noted, never sent", async () => {
  reset();
  (tables.conversations[0] as Row).window_expires_at = "2020-01-01T00:00:00Z";
  const res = await dispatchText({ workspaceId: "ws_a", conversationId: "conv_a", body: "hola", noteWhenBlocked: true });
  (tables.conversations[0] as Row).window_expires_at = null;
  assert.equal(res.errorCode, "WINDOW_EXPIRED");
  assert.equal(sends.length, 0);
  assert.equal((msgs()[0].meta as Row).reason, "send_blocked");
});

test("a conversation the send can't find is logged for the workspace", async () => {
  reset();
  await dispatchText({ workspaceId: "ws_a", conversationId: "conv_b", body: "hola", noteWhenBlocked: true });
  assert.equal(msgs().length, 0);
  assert.equal(tables.events[0]?.type, "outbound_not_sent");
});
