import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

// The chat's contact as stored in the workspace.
const chatContact = { hl_contact_id: null, phone: "+573000000001", name: "Ana Cliente" };
mock.module("@supabase/supabase-js", {
  exports: {
    createClient: () => ({
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({ data: chatContact, error: null }),
        };
        return chain;
      },
    }),
  },
});

// What reaches HighLevel's /contacts/upsert.
const upserts: { name: string | null; phone: string }[] = [];
mock.module("../../inbox/services/highlevel-client.ts", {
  exports: {
    getHLConfig: async () => ({ token: "t", locationId: "loc", calendarId: "cal" }),
    upsertHLContactByPhone: async (_cfg: unknown, c: { name: string | null; phone: string }) => {
      upserts.push(c);
      return "hl_1";
    },
    linkHLContact: async () => {},
  },
});

const appointments: Record<string, unknown>[] = [];
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  appointments.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: "apt_1" }), { status: 200 });
}) as unknown as typeof fetch;

const { scheduleHighLevelTool } = await import("./schedule-highlevel.ts");

test("in a real chat the appointment is for the person writing, not a phone the model passes", async () => {
  upserts.length = 0;
  appointments.length = 0;
  const r = await scheduleHighLevelTool.run(
    {
      datetime_iso: "2030-01-01T10:00:00-05:00",
      contact_phone: "+573009999999",
      contact_name: "Otra Persona",
    },
    { workspaceId: "ws_1", conversationId: "conv_1", contactId: "c_1" },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(upserts, [{ name: "Ana Cliente", phone: "+573000000001" }]);
  assert.equal(appointments[0].contactId, "hl_1");
  assert.equal(appointments[0].title, "Cita — Ana Cliente");
});

test("the playground (no chat contact) still books with the phone and name from the arguments", async () => {
  upserts.length = 0;
  const r = await scheduleHighLevelTool.run(
    {
      datetime_iso: "2030-01-01T10:00:00-05:00",
      contact_phone: "+573001112233",
      contact_name: "Prueba",
    },
    { workspaceId: "ws_1", conversationId: "", contactId: "" },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(upserts, [{ name: "Prueba", phone: "+573001112233" }]);
});
