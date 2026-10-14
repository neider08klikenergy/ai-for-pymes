import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceActivo } from "./estado.ts";

function db(resultado: { data?: unknown; error?: unknown } | Error): SupabaseClient {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => {
      if (resultado instanceof Error) throw resultado;
      return { data: resultado.data ?? null, error: resultado.error ?? null };
    },
  };
  return { from: () => q } as unknown as SupabaseClient;
}

test("suspendido solo cuando is_active es false", async () => {
  assert.equal(await workspaceActivo("ws", db({ data: { is_active: false } })), false);
  assert.equal(await workspaceActivo("ws", db({ data: { is_active: true } })), true);
});

test("falla abierto: un error o un workspace que no aparece cuentan como activo", async () => {
  assert.equal(await workspaceActivo("ws", db({ error: { message: "boom" } })), true);
  assert.equal(await workspaceActivo("ws", db({ data: null })), true);
  assert.equal(await workspaceActivo("ws", db(new Error("red caída"))), true);
});
