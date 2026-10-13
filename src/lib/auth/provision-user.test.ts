import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.NEXT_PUBLIC_APP_URL = "https://app.test";

const correos: Array<Record<string, unknown>> = [];
let correoOk = true;
mock.module("@/features/email/services/enviar.ts", {
  exports: {
    enviarCorreo: async (opts: Record<string, unknown>) => {
      correos.push(opts);
      return correoOk ? { ok: true, proveedorId: "m_1" } : { ok: false, error: "sin EMAIL_FROM" };
    },
  },
});

const { provisionWorkspaceUser } = await import("./provision-user.ts");

function fakeService(opts: {
  linkUserId?: string;
  linkError?: string;
  usersRow?: { id: string } | null;
  authUsers?: Array<{ id: string; email: string }>;
}) {
  const upsertCalls: unknown[] = [];
  const linkCalls: unknown[] = [];
  return {
    upsertCalls,
    linkCalls,
    client: {
      auth: {
        admin: {
          generateLink: async (p: unknown) => {
            linkCalls.push(p);
            return opts.linkUserId
              ? { data: { user: { id: opts.linkUserId }, properties: { hashed_token: "th_1" } }, error: null }
              : { data: { user: null, properties: null }, error: { message: opts.linkError ?? "email_exists" } };
          },
          listUsers: async ({ page, perPage }: { page: number; perPage: number }) => ({
            data: { users: (opts.authUsers ?? []).slice((page - 1) * perPage, page * perPage) },
            error: null,
          }),
        },
      },
      from: () => ({
        upsert: async (row: unknown) => {
          upsertCalls.push(row);
          return { error: null };
        },
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: opts.usersRow ?? null, error: null }) }),
        }),
      }),
    } as any,
  };
}

const ws = { workspaceId: "ws_1", workspaceName: "Golosita" };

function reset() {
  correos.length = 0;
  correoOk = true;
}

test("un correo nuevo: cuenta sin contraseña y enlace de un solo uso por correo", async () => {
  reset();
  const { client, upsertCalls, linkCalls } = fakeService({ linkUserId: "user_new" });
  const r = await provisionWorkspaceUser(client, " Nuevo@Example.com ", ws);
  assert.deepEqual(r, { userId: "user_new", created: true, invitacionEnviada: true });
  assert.deepEqual(linkCalls[0], { type: "invite", email: "nuevo@example.com" });
  assert.equal(correos.length, 1);
  assert.equal(correos[0].template, "invitacion");
  assert.equal(correos[0].to, "nuevo@example.com");
  assert.equal(
    (correos[0].data as { url: string }).url,
    "https://app.test/auth/confirmar?token_hash=th_1&type=invite",
  );
  assert.equal(JSON.stringify(r).includes("password"), false, "no hay contraseña que mostrar");
  assert.deepEqual(upsertCalls[0], {
    id: "user_new",
    email: "nuevo@example.com",
    full_name: "nuevo",
    is_active: true,
  });
});

test("si el correo no sale, se avisa (la cuenta queda para reenviar la invitación)", async () => {
  reset();
  correoOk = false;
  const { client } = fakeService({ linkUserId: "user_new" });
  const r = await provisionWorkspaceUser(client, "nuevo@example.com", ws);
  assert.equal(r.created, true);
  assert.equal(r.invitacionEnviada, false);
});

test("un correo que ya tiene cuenta se resuelve sin correo ni cambio de contraseña", async () => {
  reset();
  const { client } = fakeService({ usersRow: { id: "user_existing" } });
  const r = await provisionWorkspaceUser(client, "taken@example.com", ws);
  assert.deepEqual(r, { userId: "user_existing", created: false, invitacionEnviada: false });
  assert.equal(correos.length, 0);
});

test("sin fila en users, busca en auth.users", async () => {
  reset();
  const { client } = fakeService({ authUsers: [{ id: "user_auth", email: "Taken@Example.com" }] });
  const r = await provisionWorkspaceUser(client, "taken@example.com", ws);
  assert.equal(r.userId, "user_auth");
});

test("falla si no se pudo crear ni encontrar la cuenta", async () => {
  reset();
  const { client } = fakeService({ linkError: "boom" });
  await assert.rejects(() => provisionWorkspaceUser(client, "ghost@example.com", ws), /boom/);
});

test("una cuenta vieja sin fila en users se encuentra aunque esté después de la primera página", async () => {
  reset();
  const relleno = Array.from({ length: 1500 }, (_, i) => ({ id: `u_${i}`, email: `otro${i}@example.com` }));
  const { client } = fakeService({ authUsers: [...relleno, { id: "user_viejo", email: "viejo@example.com" }] });
  const r = await provisionWorkspaceUser(client, "viejo@example.com", ws);
  assert.equal(r.userId, "user_viejo");
  assert.equal(r.created, false);
});
