import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { NextRequest } from "next/server";

mock.module("@/lib/auth/workspace-access.ts", {
  exports: {
    requireWorkspaceMember: async () => ({ ok: true, userId: "user_1", role: "admin" }),
  },
});

// The workspace's stored Zernio row.
let storedConfig: Record<string, unknown> = {};
mock.module("@/features/inbox/services/zernio-routes.ts", {
  exports: {
    svc: () => ({
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { config: storedConfig }, error: null }),
        };
        return chain;
      },
    }),
    zernioErrorMessage: () => "error",
  },
});

mock.module("@/features/inbox/services/zernio-accounts.ts", {
  exports: {
    accountsOf: (config: Record<string, unknown>) =>
      Array.isArray(config.accounts) ? config.accounts : [],
    syncZernioAccounts: async () => [],
  },
});

// What Zernio says the profile holds, and what gets disconnected.
let profileAccounts: { id: string }[] = [];
const listed: string[] = [];
const disconnected: string[] = [];
mock.module("@/features/inbox/services/zernio-client.ts", {
  exports: {
    listAccounts: async (profileId: string) => {
      listed.push(profileId);
      return profileAccounts;
    },
    disconnectAccount: async (accountId: string) => {
      disconnected.push(accountId);
    },
  },
});

const { DELETE } = await import("./route.ts");

function del(accountId: string) {
  return DELETE(
    new NextRequest(`http://localhost/api/workspace/ws_1/zernio/accounts/${accountId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id: "ws_1", accountId }) },
  );
}

test("DELETE disconnects an account that Zernio lists in the workspace's profile", async () => {
  storedConfig = { profile_id: "p_own", accounts: [{ id: "acc_own" }] };
  profileAccounts = [{ id: "acc_own" }];
  listed.length = 0;
  disconnected.length = 0;
  const res = await del("acc_own");
  assert.equal(res.status, 200);
  assert.deepEqual(listed, ["p_own"]);
  assert.deepEqual(disconnected, ["acc_own"]);
});

test("DELETE refuses an account written into the config that is not in the workspace's Zernio profile", async () => {
  // A config that claims another workspace's account (e.g. written before the
  // server-only keys were enforced) must not reach the platform-wide key.
  storedConfig = { profile_id: "p_own", accounts: [{ id: "acc_other" }] };
  profileAccounts = [{ id: "acc_own" }];
  disconnected.length = 0;
  const res = await del("acc_other");
  assert.equal(res.status, 404);
  assert.deepEqual(disconnected, []);
});

test("DELETE refuses when the workspace has no Zernio profile", async () => {
  storedConfig = { accounts: [{ id: "acc_own" }] };
  listed.length = 0;
  disconnected.length = 0;
  const res = await del("acc_own");
  assert.equal(res.status, 404);
  assert.deepEqual(listed, []);
  assert.deepEqual(disconnected, []);
});
