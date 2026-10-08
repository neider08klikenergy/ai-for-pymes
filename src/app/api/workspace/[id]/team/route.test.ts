import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { NextRequest, NextResponse } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";

// ── Caller ───────────────────────────────────────────────────────────────────
let actorRole: "admin" | "manager" | "agent" | "viewer" = "manager";

mock.module("@/lib/auth/workspace-access.ts", {
  exports: {
    requireWorkspaceMember: async (
      _ws: string,
      opts?: { minRole?: string },
    ) => {
      const rank = { viewer: 0, agent: 1, manager: 2, admin: 3 } as const;
      if (opts?.minRole && rank[actorRole] < rank[opts.minRole as keyof typeof rank]) {
        return {
          ok: false,
          response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
        };
      }
      return { ok: true, userId: "actor", role: actorRole };
    },
    readJsonBody: async (req: NextRequest) => ({ ok: true, body: await req.json() }),
  },
});

// ── Service-role memberships table ───────────────────────────────────────────
type Membership = {
  workspace_id: string;
  user_id: string;
  role: string;
  is_active: boolean;
};
let memberships: Membership[] = [];
let writes: Array<{ kind: string; row: unknown; eqArgs?: unknown[][] }> = [];

function membershipsTable() {
  const filters: Array<(m: Membership) => boolean> = [];
  let countMode = false;
  const rows = () => memberships.filter((m) => filters.every((f) => f(m)));
  const q: any = {
    select: (_cols: string, opts?: { count?: string }) => {
      countMode = Boolean(opts?.count);
      return q;
    },
    eq: (col: string, val: unknown) => {
      filters.push((m) => (m as any)[col] === val);
      return q;
    },
    neq: (col: string, val: unknown) => {
      filters.push((m) => (m as any)[col] !== val);
      return q;
    },
    // Like PostgREST: more than one row is an error, not "the first one".
    maybeSingle: async () =>
      rows().length > 1
        ? { data: null, error: { message: "multiple rows" } }
        : { data: rows()[0] ?? null, error: null },
    then: (resolve: (v: unknown) => void) =>
      resolve(countMode ? { count: rows().length, error: null } : { data: rows(), error: null }),
  };
  return q;
}

// ── Service-role invitaciones_equipo table ───────────────────────────────────
type Invitation = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  estado: string;
  invitado_por?: string;
};
let invitations: Invitation[] = [];

function invitationsTable() {
  const filters: Array<(i: Invitation) => boolean> = [];
  const rows = () => invitations.filter((i) => filters.every((f) => f(i)));
  const filtering: any = {
    eq: (col: string, val: unknown) => {
      filters.push((i) => (i as any)[col] === val);
      return filtering;
    },
  };
  return {
    select: () => {
      const q: any = {
        eq: (col: string, val: unknown) => {
          filtering.eq(col, val);
          return q;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      };
      return q;
    },
    insert: async (row: Omit<Invitation, "id" | "estado">) => {
      writes.push({ kind: "invitation-insert", row });
      invitations.push({ id: `inv_${invitations.length + 1}`, estado: "pendiente", ...row });
      return { error: null };
    },
    update: (row: Partial<Invitation>) => {
      writes.push({ kind: "invitation-update", row });
      const q: any = {
        eq: (col: string, val: unknown) => {
          filtering.eq(col, val);
          return q;
        },
        then: (resolve: (v: unknown) => void) => {
          for (const i of rows()) Object.assign(i, row);
          resolve({ error: null });
        },
      };
      return q;
    },
  };
}

mock.module("@supabase/supabase-js", {
  exports: {
    createClient: () => ({
      from: (table: string) => table === "invitaciones_equipo" ? invitationsTable() : ({
        select: (cols: string, opts?: { count?: string }) =>
          membershipsTable().select(cols, opts),
        update: (row: unknown) => {
          const eqArgs: unknown[][] = [];
          writes.push({ kind: "update", row, eqArgs });
          const chain: any = {
            eq: (col: string, val: unknown) => {
              eqArgs.push([col, val]);
              return chain;
            },
            then: (r: any) => r({ error: null }),
          };
          return chain;
        },
        upsert: async (row: unknown) => {
          writes.push({ kind: "upsert", row });
          return { error: null };
        },
      }),
    }),
  },
});

// boss@x.com is ws_1's active admin, former@x.com an inactive ex-member,
// other@x.com an account from another workspace, new@x.com a brand-new one.
const ACCOUNTS: Record<string, { userId: string; created: boolean }> = {
  "boss@x.com": { userId: "u_admin", created: false },
  "former@x.com": { userId: "u_former", created: false },
  "other@x.com": { userId: "u_other_admin", created: false },
};
mock.module("@/lib/auth/provision-user.ts", {
  exports: {
    provisionWorkspaceUser: async (_db: unknown, email: string) => {
      const known = ACCOUNTS[email];
      return known
        ? { userId: known.userId, password: null, created: false }
        : { userId: "u_new", password: "generated", created: true };
    },
  },
});

const { POST, PATCH, DELETE } = await import("./route.ts");

const params = { params: Promise.resolve({ id: "ws_1" }) };
function req(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/workspace/ws_1/team", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const U_ADMIN = "00000000-0000-4000-8000-00000000000a";
const U_MANAGER = "00000000-0000-4000-8000-00000000000b";
const U_AGENT = "00000000-0000-4000-8000-00000000000c";

function reset(role: typeof actorRole) {
  actorRole = role;
  writes = [];
  invitations = [];
  memberships = [
    { workspace_id: "ws_1", user_id: "u_former", role: "agent", is_active: false },
    { workspace_id: "ws_1", user_id: U_ADMIN, role: "admin", is_active: true },
    { workspace_id: "ws_1", user_id: U_MANAGER, role: "manager", is_active: true },
    { workspace_id: "ws_1", user_id: U_AGENT, role: "agent", is_active: true },
    { workspace_id: "ws_1", user_id: "u_admin", role: "admin", is_active: true },
    // Another tenant: must never count for, or leak into, ws_1's decisions.
    { workspace_id: "ws_2", user_id: U_AGENT, role: "admin", is_active: true },
    { workspace_id: "ws_2", user_id: "u_other_admin", role: "admin", is_active: true },
  ];
}

test("manager cannot promote anyone (themselves included) to admin or manager", async () => {
  reset("manager");
  for (const role of ["admin", "manager"]) {
    const res = await PATCH(req("PATCH", { userId: U_AGENT, role }), params);
    assert.equal(res.status, 403, `role ${role}`);
  }
  const self = await PATCH(req("PATCH", { userId: U_MANAGER, role: "admin" }), params);
  assert.equal(self.status, 403);
  assert.equal(writes.length, 0);
});

test("manager cannot demote or deactivate an admin", async () => {
  reset("manager");
  assert.equal((await PATCH(req("PATCH", { userId: U_ADMIN, role: "viewer" }), params)).status, 403);
  assert.equal((await PATCH(req("PATCH", { userId: U_ADMIN, is_active: false }), params)).status, 403);
  assert.equal((await DELETE(req("DELETE", { userId: U_ADMIN }), params)).status, 403);
  assert.equal(writes.length, 0);
});

test("manager can still manage agents and viewers, writing only this workspace", async () => {
  reset("manager");
  const res = await PATCH(req("PATCH", { userId: U_AGENT, role: "viewer" }), params);
  assert.equal(res.status, 200);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].eqArgs, [
    ["workspace_id", "ws_1"],
    ["user_id", U_AGENT],
  ]);
});

test("manager cannot invite an admin, nor re-invite an existing admin with a lower role", async () => {
  reset("manager");
  assert.equal(
    (await POST(req("POST", { email: "new@x.com", role: "admin" }), params)).status,
    403,
  );
  assert.equal(
    (await POST(req("POST", { email: "boss@x.com", role: "viewer" }), params)).status,
    403,
  );
  assert.equal(writes.length, 0);
  assert.equal(
    (await POST(req("POST", { email: "new@x.com", role: "agent" }), params)).status,
    200,
  );
});

test("admin can promote to admin", async () => {
  reset("admin");
  const res = await PATCH(req("PATCH", { userId: U_MANAGER, role: "admin" }), params);
  assert.equal(res.status, 200);
});

test("the last active admin cannot be demoted or deactivated", async () => {
  reset("admin");
  memberships = memberships.filter((m) => m.user_id !== "u_admin");
  assert.equal((await PATCH(req("PATCH", { userId: U_ADMIN, role: "manager" }), params)).status, 409);
  assert.equal((await DELETE(req("DELETE", { userId: U_ADMIN }), params)).status, 409);
  assert.equal(writes.length, 0);
});

test("an admin can step down while another active admin remains", async () => {
  reset("admin");
  const res = await PATCH(req("PATCH", { userId: U_ADMIN, role: "manager" }), params);
  assert.equal(res.status, 200);
});

test("unknown member → 404", async () => {
  reset("admin");
  const res = await PATCH(
    req("PATCH", { userId: "00000000-0000-4000-8000-0000000000ff", role: "agent" }),
    params,
  );
  assert.equal(res.status, 404);
});

test("an admin of another workspace does not count as ws_1's remaining admin", async () => {
  reset("admin");
  memberships = memberships.filter((m) => !(m.workspace_id === "ws_1" && m.user_id === "u_admin"));
  const res = await PATCH(req("PATCH", { userId: U_ADMIN, is_active: false }), params);
  assert.equal(res.status, 409);
  assert.equal(writes.length, 0);
});

test("the ceiling uses the target's role in THIS workspace, not in another one", async () => {
  reset("manager");
  // U_AGENT is admin in ws_2 but an agent in ws_1: a ws_1 manager may manage them.
  const res = await PATCH(req("PATCH", { userId: U_AGENT, role: "viewer" }), params);
  assert.equal(res.status, 200);
});

// ── Invitations: an account that already existed joins only if it accepts ────

test("an account from another workspace gets an invitation, not a membership", async () => {
  reset("manager");
  const res = await POST(req("POST", { email: "other@x.com", role: "agent" }), params);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, invitacion: true, credentials: null });
  assert.equal(writes.filter((w) => w.kind === "upsert").length, 0, "no membership is written");
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].user_id, "u_other_admin");
  assert.equal(invitations[0].role, "agent");
  assert.equal(invitations[0].invitado_por, "actor");
});

test("re-inviting renews the pending invitation instead of adding another", async () => {
  reset("manager");
  await POST(req("POST", { email: "other@x.com", role: "agent" }), params);
  await POST(req("POST", { email: "other@x.com", role: "viewer" }), params);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].role, "viewer");
});

test("a former (inactive) member is invited again, not silently reactivated", async () => {
  reset("manager");
  const res = await POST(req("POST", { email: "former@x.com", role: "agent" }), params);
  assert.equal((await res.json()).invitacion, true);
  assert.equal(writes.filter((w) => w.kind === "upsert").length, 0);
  assert.equal(memberships.find((m) => m.user_id === "u_former")?.is_active, false);
});

test("an active member's role change and a brand-new account skip the invitation", async () => {
  reset("admin");
  const roleChange = await POST(req("POST", { email: "boss@x.com", role: "manager" }), params);
  assert.equal((await roleChange.json()).invitacion, undefined);
  const nueva = await POST(req("POST", { email: "new@x.com", role: "agent" }), params);
  assert.deepEqual((await nueva.json()).credentials, { email: "new@x.com", password: "generated" });
  assert.equal(writes.filter((w) => w.kind === "upsert").length, 2);
  assert.equal(invitations.length, 0);
});

test("a manager cancels an agent's invitation but not an admin's", async () => {
  reset("manager");
  invitations = [
    { id: "00000000-0000-4000-8000-0000000000e1", workspace_id: "ws_1", user_id: "u_x", role: "agent", estado: "pendiente" },
    { id: "00000000-0000-4000-8000-0000000000e2", workspace_id: "ws_1", user_id: "u_y", role: "admin", estado: "pendiente" },
    { id: "00000000-0000-4000-8000-0000000000e3", workspace_id: "ws_2", user_id: "u_z", role: "agent", estado: "pendiente" },
  ];
  const ok = await DELETE(req("DELETE", { invitacionId: "00000000-0000-4000-8000-0000000000e1" }), params);
  assert.equal(ok.status, 200);
  assert.equal(invitations[0].estado, "cancelada");
  const admin = await DELETE(req("DELETE", { invitacionId: "00000000-0000-4000-8000-0000000000e2" }), params);
  assert.equal(admin.status, 403);
  assert.equal(invitations[1].estado, "pendiente");
  // Another workspace's invitation is not found from ws_1.
  const ajena = await DELETE(req("DELETE", { invitacionId: "00000000-0000-4000-8000-0000000000e3" }), params);
  assert.equal(ajena.status, 404);
  assert.equal(invitations[2].estado, "pendiente");
});

test("reactivating a former member sends an invitation instead of reactivating them", async () => {
  reset("manager");
  const res = await PATCH(req("PATCH", { userId: "00000000-0000-4000-8000-00000000f0f0", is_active: true }), params);
  // Unknown id → 404 as before.
  assert.equal(res.status, 404);

  memberships.push({ workspace_id: "ws_1", user_id: "00000000-0000-4000-8000-00000000f0f0", role: "viewer", is_active: false });
  const again = await PATCH(req("PATCH", { userId: "00000000-0000-4000-8000-00000000f0f0", is_active: true }), params);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).invitacion, true);
  assert.equal(writes.filter((w) => w.kind === "update").length, 0, "the membership is not reactivated");
  assert.equal(memberships.at(-1)?.is_active, false);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].role, "viewer", "keeps the previous role");
});

test("a manager cannot re-invite a former admin by reactivating them", async () => {
  reset("manager");
  memberships.push({ workspace_id: "ws_1", user_id: "00000000-0000-4000-8000-00000000f0f1", role: "admin", is_active: false });
  const res = await PATCH(req("PATCH", { userId: "00000000-0000-4000-8000-00000000f0f1", is_active: true }), params);
  assert.equal(res.status, 403);
  assert.equal(invitations.length, 0);
});
