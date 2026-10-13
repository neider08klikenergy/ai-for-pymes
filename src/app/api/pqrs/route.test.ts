import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { NextRequest } from "next/server";

// POST /api/pqrs: solo miembros activos, valida, limita por hora, guarda la
// imagen en el bucket privado y la borra si la fila no se pudo guardar.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567";

const WS = "00000000-0000-4000-8000-0000000000a1";
let miembro = true;
let recientes = 0;
let insertError: { message: string } | null = null;
let inserts: Array<Record<string, unknown>> = [];
let subidas: string[] = [];
let borradas: string[] = [];

mock.module("@/lib/auth/workspace-access.ts", {
  exports: {
    checkWorkspaceMember: async (ws: string) =>
      miembro && ws === WS ? { ok: true, userId: "u_admin", role: "admin" } : { ok: false, status: 403 },
  },
});

const fakeDb = {
  from: () => ({
    select: () => {
      const q = { eq: () => q, gte: async () => ({ count: recientes, error: null }) };
      return q;
    },
    insert: async (row: Record<string, unknown>) => {
      inserts.push(row);
      return { error: insertError };
    },
  }),
  storage: {
    from: (bucket: string) => {
      assert.equal(bucket, "pqrs");
      return {
        upload: async (path: string) => {
          subidas.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          borradas.push(...paths);
          return { error: null };
        },
      };
    },
  },
};
mock.module("@supabase/supabase-js", { exports: { createClient: () => fakeDb } });

const { POST } = await import("./route.ts");

function reset() {
  miembro = true;
  recientes = 0;
  insertError = null;
  inserts = [];
  subidas = [];
  borradas = [];
}

function enviar(campos: Record<string, string>, archivo?: File) {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.set(k, v);
  if (archivo) form.set("file", archivo);
  return POST(
    new NextRequest("http://localhost/api/pqrs", {
      method: "POST",
      body: form,
      headers: { "user-agent": "Prueba/1.0" },
    }),
  );
}

const valido = {
  workspaceId: WS,
  tipo: "falla",
  asunto: "No carga el inbox",
  descripcion: "Al abrir el inbox se queda cargando para siempre.",
  pagina: "/inbox",
};

test("guarda la PQRS con su contexto y la imagen en el bucket privado", async () => {
  reset();
  const png = new File([new Uint8Array([1, 2, 3])], "captura.png", { type: "image/png" });
  const res = await enviar(valido, png);
  assert.equal(res.status, 200);
  assert.equal(subidas.length, 1);
  assert.match(subidas[0], new RegExp(`^${WS}/[0-9a-f-]+\\.png$`));
  assert.equal(inserts.length, 1);
  assert.deepEqual(
    { ...inserts[0], imagen_path: undefined },
    {
      workspace_id: WS,
      creado_por: "u_admin",
      tipo: "falla",
      asunto: "No carga el inbox",
      descripcion: "Al abrir el inbox se queda cargando para siempre.",
      imagen_path: undefined,
      contexto: { pagina: "/inbox", navegador: "Prueba/1.0", version: "abcdef1" },
    },
  );
  assert.equal(inserts[0].imagen_path, subidas[0]);
});

test("sin imagen también se guarda", async () => {
  reset();
  const res = await enviar(valido);
  assert.equal(res.status, 200);
  assert.equal(subidas.length, 0);
  assert.equal(inserts[0].imagen_path, null);
});

test("quien no es miembro activo del workspace no puede reportar", async () => {
  reset();
  miembro = false;
  const res = await enviar(valido);
  assert.equal(res.status, 403);
  assert.equal(inserts.length, 0);
});

test("valida tipo, asunto, descripción e imagen", async () => {
  reset();
  assert.equal((await enviar({ ...valido, tipo: "otro" })).status, 400);
  assert.equal((await enviar({ ...valido, descripcion: "corta" })).status, 400);
  const gif = new File([new Uint8Array([1])], "a.gif", { type: "image/gif" });
  assert.equal((await enviar(valido, gif)).status, 400);
  assert.equal(inserts.length + subidas.length, 0);
});

test("después de 10 en una hora responde 429 sin guardar", async () => {
  reset();
  recientes = 10;
  const res = await enviar(valido);
  assert.equal(res.status, 429);
  assert.equal(inserts.length, 0);
});

test("si la fila no se guarda, borra la imagen que ya subió", async () => {
  reset();
  insertError = { message: "boom" };
  const original = console.error;
  console.error = () => {};
  try {
    const png = new File([new Uint8Array([1])], "c.png", { type: "image/png" });
    const res = await enviar(valido, png);
    assert.equal(res.status, 500);
    assert.deepEqual(borradas, subidas);
  } finally {
    console.error = original;
  }
});
