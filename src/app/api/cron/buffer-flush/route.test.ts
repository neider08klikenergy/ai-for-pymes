import assert from "node:assert/strict";
import { test, mock } from "node:test";

const processCalls: number[] = [];
let reconcileCalls = 0;
// Results processNextBatch returns in order; empty → nothing left to claim.
let queue: Array<{ processed: boolean; error?: string }> = [];
let timeLeft = true;
mock.module("@/features/inbox/services/buffer.ts", {
  exports: {
    processNextBatch: async () => {
      processCalls.push(1);
      return queue.shift() ?? { processed: false };
    },
    reconcileOrphanedMessages: async () => {
      orden.push("reconcile");
      reconcileCalls++;
      return 2;
    },
    hasTimeToClaim: () => timeLeft,
  },
});

const orden: string[] = [];
let seguimientoFalla = false;
mock.module("@/features/notificaciones/services/seguimiento.ts", {
  exports: {
    revisarSeguimiento: async () => {
      orden.push("seguimiento");
      if (seguimientoFalla) throw new Error("boom");
      return { revisadas: 1, retomadas: 0, recordadas: 0 };
    },
  },
});

let correosFallan = false;
mock.module("@/features/email/services/notificaciones.ts", {
  exports: {
    procesarCorreosPendientes: async () => {
      orden.push("correos");
      if (correosFallan) throw new Error("smtp caído");
      return { notificaciones: 1, enviados: 1, fallidos: 0 };
    },
  },
});

const { GET, maxDuration } = await import("./route.ts");

function req(auth?: string) {
  return new Request("http://localhost/api/cron/buffer-flush", {
    headers: auth ? { Authorization: auth } : {},
  });
}

test("fails closed when CRON_SECRET is not configured", async () => {
  delete process.env.CRON_SECRET;
  processCalls.length = 0;
  const res = await GET(req("Bearer undefined"));
  assert.equal(res.status, 401);
  assert.equal(processCalls.length, 0);
});

test("401 on a wrong or missing bearer", async () => {
  process.env.CRON_SECRET = "s3cret";
  processCalls.length = 0;
  assert.equal((await GET(req("Bearer nope"))).status, 401);
  assert.equal((await GET(req())).status, 401);
  assert.equal(processCalls.length, 0);
});

test("runs the drain with the right bearer", async () => {
  process.env.CRON_SECRET = "s3cret";
  processCalls.length = 0;
  const res = await GET(req("Bearer s3cret"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    processed: 0,
    recovered: 2,
    seguimiento: { revisadas: 1, retomadas: 0, recordadas: 0 },
    correos: { notificaciones: 1, enviados: 1, fallidos: 0 },
  });
  assert.equal(processCalls.length, 1);
});

test("orphans are reconciled only for an authorized tick", async () => {
  delete process.env.CRON_SECRET;
  reconcileCalls = 0;
  await GET(req("Bearer undefined"));
  assert.equal(reconcileCalls, 0);
  process.env.CRON_SECRET = "s3cret";
  await GET(req("Bearer s3cret"));
  assert.equal(reconcileCalls, 1);
});

test("declares maxDuration below claim_next_batch's 7-minute lease", () => {
  assert.equal(maxDuration, 300);
});

test("a failed batch doesn't stop the drain; nothing left does", async () => {
  process.env.CRON_SECRET = "s3cret";
  processCalls.length = 0;
  timeLeft = true;
  queue = [{ processed: true }, { processed: false, error: "boom" }, { processed: true }];
  const res = await GET(req("Bearer s3cret"));
  assert.equal(processCalls.length, 4, "3 results, then an empty claim ends it");
  assert.equal((await res.json()).processed, 2);
});

test("no batch is claimed without time left to finish it", async () => {
  process.env.CRON_SECRET = "s3cret";
  processCalls.length = 0;
  timeLeft = false;
  queue = [{ processed: true }];
  await GET(req("Bearer s3cret"));
  assert.equal(processCalls.length, 0);
  timeLeft = true;
});

test("el seguimiento corre antes del rescate de huérfanos y si falla no frena el drenado", async () => {
  process.env.CRON_SECRET = "s3cret";
  orden.length = 0;
  seguimientoFalla = true;
  timeLeft = true;
  queue = [];
  const res = await GET(req("Bearer s3cret"));
  assert.equal(res.status, 200);
  assert.deepEqual(orden, ["seguimiento", "reconcile", "correos"]);
  assert.equal((await res.json()).seguimiento, null);
  seguimientoFalla = false;
});

test("los correos van después del buffer y un fallo no rompe el cron", async () => {
  process.env.CRON_SECRET = "s3cret";
  orden.length = 0;
  queue = [];
  timeLeft = true;
  correosFallan = true;
  const res = await GET(req("Bearer s3cret"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { correos: unknown };
  assert.equal(body.correos, null);
  assert.equal(orden.at(-1), "correos");
  correosFallan = false;
  const ok = (await (await GET(req("Bearer s3cret"))).json()) as { correos: { enviados: number } };
  assert.equal(ok.correos.enviados, 1);
});
