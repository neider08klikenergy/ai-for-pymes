import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
process.env.CRON_SECRET = "c".repeat(64);

// IP de la petición (la pone el proxy de la plataforma).
let ip = "203.0.113.7";
mock.module("next/headers", {
  exports: { headers: async () => new Headers({ "x-real-ip": ip }) },
});
mock.module("next/cache", { exports: { revalidatePath: () => {} } });
mock.module("@/lib/supabase/server.ts", { exports: { createClient: async () => ({}) } });

// Tabla solicitudes_demo en memoria.
type Fila = { correo: string; ip_hash: string | null; created_at: string };
let filas: Fila[] = [];
mock.module("@supabase/supabase-js", {
  exports: {
    createClient: () => ({
      from: () => ({
        select: () => {
          const filtros: Array<(f: Fila) => boolean> = [];
          const q: any = {
            eq: (col: keyof Fila, v: unknown) => {
              filtros.push((f) => f[col] === v);
              return q;
            },
            gte: (col: keyof Fila, v: string) => {
              filtros.push((f) => String(f[col]) >= v);
              return q;
            },
            then: (resolve: (r: unknown) => void) =>
              resolve({ count: filas.filter((f) => filtros.every((p) => p(f))).length, error: null }),
          };
          return q;
        },
        insert: async (row: Fila) => {
          filas.push({ ...row, created_at: new Date().toISOString() });
          return { error: null };
        },
      }),
    }),
  },
});

const { crearSolicitudDemo } = await import("./solicitudes-actions.ts");
const { hashIp } = await import("../lib/origen.ts");

const solicitud = (correo: string) => ({
  nombre: "Mónica",
  empresa: "Golosita",
  correo,
  whatsapp: "+57 310 320 8950",
});

test("se guarda con el hash de la IP, nunca la IP en claro", async () => {
  filas = [];
  ip = "203.0.113.7";
  assert.deepEqual(await crearSolicitudDemo(solicitud("a@x.co")), { ok: true });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].ip_hash, hashIp("203.0.113.7"));
  assert.ok(!JSON.stringify(filas[0]).includes("203.0.113.7"));
});

test("cambiar de correo no evita el límite por conexión", async () => {
  filas = [];
  ip = "203.0.113.8";
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(await crearSolicitudDemo(solicitud(`p${i}@x.co`)), { ok: true });
  }
  // 5 por hora desde la misma IP; el resto responde ok pero no se guarda.
  assert.equal(filas.length, 5);

  // Otra conexión sigue pudiendo pedir su demo.
  ip = "198.51.100.1";
  await crearSolicitudDemo(solicitud("otra@x.co"));
  assert.equal(filas.length, 6);
});

test("el tope total por hora frena un ataque que rota de IP", async () => {
  filas = [];
  const original = console.warn;
  let avisos = 0;
  console.warn = () => {
    avisos++;
  };
  try {
    for (let i = 0; i < 65; i++) {
      ip = `192.0.2.${i}`;
      await crearSolicitudDemo(solicitud(`r${i}@x.co`));
    }
  } finally {
    console.warn = original;
  }
  assert.equal(filas.length, 60);
  assert.equal(avisos, 5);
});

test("el campo trampa sigue descartando bots sin guardar", async () => {
  filas = [];
  ip = "203.0.113.9";
  assert.deepEqual(await crearSolicitudDemo({ ...solicitud("bot@x.co"), sitio_web: "http://spam" }), { ok: true });
  assert.equal(filas.length, 0);
});
