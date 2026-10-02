import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUISITOS_CANAL } from "./requisitos-canales.ts";

test("cada canal tiene requisitos y ayuda si falla", () => {
  for (const canal of ["whatsapp", "instagram", "facebook"] as const) {
    const r = REQUISITOS_CANAL[canal];
    assert.ok(r.requisitos.length >= 3, canal);
    assert.ok(r.siFalla.length >= 1, canal);
    // Las claves de React salen del texto: no puede repetirse.
    assert.equal(new Set(r.requisitos.map((x) => x.texto)).size, r.requisitos.length, canal);
  }
});

test("Instagram exige cuenta profesional y Facebook una Página", () => {
  assert.ok(REQUISITOS_CANAL.instagram.requisitos.some((r) => /profesional/.test(r.texto)));
  assert.ok(REQUISITOS_CANAL.facebook.requisitos.some((r) => /Página de Facebook/.test(r.texto)));
});
