import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
process.env.EMAIL_UNSUBSCRIBE_SECRET = "s".repeat(48);

// Las bajas que llegan a preferencias_correo.
const updates: { values: unknown; filtros: [string, unknown][] }[] = [];
mock.module("@supabase/supabase-js", {
  exports: {
    createClient: () => ({
      from: () => ({
        update: (values: unknown) => {
          const filtros: [string, unknown][] = [];
          const chain: any = {
            eq: (col: string, v: unknown) => {
              filtros.push([col, v]);
              return chain;
            },
            then: (resolve: (r: unknown) => void) => {
              updates.push({ values, filtros });
              resolve({ error: null });
            },
          };
          return chain;
        },
      }),
    }),
  },
});

const { urlBaja } = await import("@/features/email/lib/baja.ts");
const { GET, POST } = await import("./route.ts");

const U = "00000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000002";
const url = urlBaja("http://localhost", U, W)!;

function form(target: string, confirmar: string) {
  return new NextRequest(target, {
    method: "POST",
    body: new URLSearchParams({ confirmar }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

test("GET only shows the confirmation page: opening the link changes nothing", async () => {
  updates.length = 0;
  const res = await GET(new NextRequest(url));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Dejar de recibir estos correos\?/);
  assert.match(html, /<form method="post"/);
  assert.equal(updates.length, 0);
});

test("the confirmation button (POST confirmar=1) unsubscribes and shows a page", async () => {
  updates.length = 0;
  const res = await POST(form(url, "1"));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /ya no recibirás estos correos/);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].filtros, [["user_id", U], ["workspace_id", W]]);
});

test("one-click POST from the mail client (List-Unsubscribe-Post) still unsubscribes", async () => {
  updates.length = 0;
  const res = await POST(
    new NextRequest(url, {
      method: "POST",
      body: "List-Unsubscribe=One-Click",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(updates.length, 1);
});

test("a link with a bad signature is rejected on GET and POST", async () => {
  updates.length = 0;
  const malo = `http://localhost/api/email/baja?u=${U}&w=${W}&t=forjado`;
  assert.equal((await GET(new NextRequest(malo))).status, 400);
  assert.equal((await POST(form(malo, "1"))).status, 400);
  assert.equal(updates.length, 0);
});
