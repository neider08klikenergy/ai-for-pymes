import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-key";
mock.module("@supabase/supabase-js", { exports: { createClient: () => ({}) } });

const { recortarTurno, MAX_CARACTERES_TURNO } = await import("./buffer.ts");
const { recortarHistorial, MAX_CARACTERES_MENSAJE_HISTORIAL, MAX_CARACTERES_HISTORIAL } = await import(
  "./conversation-history.ts"
);
const { estimarTokensTurno } = await import("./cost-tracker.ts");

test("un lote corto pasa tal cual; uno largo se queda con lo más reciente y avisa", () => {
  assert.equal(recortarTurno("hola"), "hola");
  const largo = "a".repeat(MAX_CARACTERES_TURNO) + "FINAL";
  const r = recortarTurno(largo);
  assert.match(r, /^\[Mensajes anteriores del cliente recortados por longitud\]\n/);
  assert.ok(r.endsWith("FINAL"));
  assert.ok(r.length <= MAX_CARACTERES_TURNO + 80);
});

test("el historial recorta cada mensaje y deja de incluir los más viejos al pasar el total", () => {
  const largo = { role: "user" as const, content: "x".repeat(MAX_CARACTERES_MENSAJE_HISTORIAL * 3) };
  const uno = recortarHistorial([largo]);
  assert.equal(uno[0].content.length, MAX_CARACTERES_MENSAJE_HISTORIAL + 1);

  const muchos = Array.from({ length: 50 }, (_, i) => ({ role: "user" as const, content: `${i}:` + "y".repeat(1400) }));
  const r = recortarHistorial(muchos);
  const total = r.reduce((n, t) => n + t.content.length, 0);
  assert.ok(total <= MAX_CARACTERES_HISTORIAL);
  assert.ok(r.length < 50);
  assert.ok(r[0].content.startsWith("0:"), "se conservan los más nuevos (el primero de la lista)");
});

test("la estimación de un turno fallido incluye la entrada y la salida máxima", () => {
  assert.equal(estimarTokensTurno(4000), 1000 + 1024);
  assert.equal(estimarTokensTurno(0), 1024);
});
