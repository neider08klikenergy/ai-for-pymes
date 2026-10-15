import assert from "node:assert/strict";
import { test } from "node:test";
import { PerfilSchema, enlaceWhatsapp } from "./perfil.ts";

test("normaliza correo y números (uno por línea o con coma, sin espacios ni guiones)", () => {
  const r = PerfilSchema.parse({
    email: " Soporte@Falvrick.co ",
    whatsapp: "+57 300 123-4567\n\n+1 (555) 000 1111, ",
  });
  assert.deepEqual(r, { email: "soporte@falvrick.co", whatsapp: ["+573001234567", "+15550001111"] });
});

test("vacío es válido: no se muestra nada", () => {
  assert.deepEqual(PerfilSchema.parse({ email: "", whatsapp: "" }), { email: null, whatsapp: [] });
});

test("rechaza correo inválido, número sin + y más de 5 números", () => {
  assert.equal(PerfilSchema.safeParse({ email: "no-es-correo", whatsapp: "" }).success, false);
  assert.equal(PerfilSchema.safeParse({ email: "", whatsapp: "3001234567" }).success, false);
  const seis = Array.from({ length: 6 }, (_, i) => `+5730012345${i}0`).join("\n");
  assert.equal(PerfilSchema.safeParse({ email: "", whatsapp: seis }).success, false);
});

test("enlace de WhatsApp solo con dígitos", () => {
  assert.equal(enlaceWhatsapp("+573001234567"), "https://wa.me/573001234567");
});
