import assert from "node:assert/strict";
import { test, mock } from "node:test";

// cambiarContrasena: exige la contraseña actual (verificada con un cliente sin
// sesión), y solo entonces cambia la contraseña y cierra las demás sesiones.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const calls: string[] = [];
let actualCorrecta = true;

mock.module("next-intl/server", {
  exports: {
    getTranslations: async () => {
      const t = (k: string) => `t:${k}`;
      t.has = () => true;
      return t;
    },
  },
});
mock.module("next/headers", { exports: { headers: async () => new Headers() } });
mock.module("next/navigation", { exports: { redirect: () => {} } });
mock.module("@/lib/supabase/server.ts", {
  exports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { email: "ana@x.com" } } }),
        updateUser: async (p: { password: string }) => {
          calls.push(`update:${p.password}`);
          return { error: null };
        },
        signOut: async (o: { scope: string }) => {
          calls.push(`signOut:${o.scope}`);
          return { error: null };
        },
      },
    }),
  },
});
mock.module("@supabase/supabase-js", {
  exports: {
    createClient: (_u: string, _k: string, opts: { auth: { persistSession: boolean } }) => {
      assert.equal(opts.auth.persistSession, false, "la verificación no guarda sesión");
      return {
        auth: {
          signInWithPassword: async (p: { email: string; password: string }) => {
            calls.push(`verify:${p.email}:${p.password}`);
            return { error: actualCorrecta ? null : { message: "Invalid login credentials" } };
          },
          signOut: async () => ({ error: null }),
        },
      };
    },
  },
});

const { cambiarContrasena } = await import("./actions.ts");

function form(actual: string, nueva: string, confirmar = nueva) {
  const f = new FormData();
  f.set("actual", actual);
  f.set("nueva", nueva);
  f.set("confirmar", confirmar);
  return f;
}

test("con la contraseña actual correcta, la cambia y cierra las otras sesiones", async () => {
  calls.length = 0;
  actualCorrecta = true;
  const r = await cambiarContrasena(null, form("vieja-123", "nueva-segura-1"));
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, ["verify:ana@x.com:vieja-123", "update:nueva-segura-1", "signOut:others"]);
});

test("con la actual incorrecta no cambia nada", async () => {
  calls.length = 0;
  actualCorrecta = false;
  const r = await cambiarContrasena(null, form("mala", "nueva-segura-1"));
  assert.equal(r.error, "t:contrasenaActualIncorrecta");
  assert.ok(!calls.some((c) => c.startsWith("update")));
});

test("valida largo, confirmación y que sea distinta, sin llamar a Supabase", async () => {
  calls.length = 0;
  actualCorrecta = true;
  assert.equal((await cambiarContrasena(null, form("vieja-123", "corta"))).error, "t:contrasenaCorta");
  assert.equal((await cambiarContrasena(null, form("vieja-123", "nueva-segura-1", "otra-cosa-12"))).error, "t:noCoinciden");
  assert.equal((await cambiarContrasena(null, form("misma-clave-1", "misma-clave-1"))).error, "t:contrasenaIgual");
  assert.equal(calls.length, 0);
});
