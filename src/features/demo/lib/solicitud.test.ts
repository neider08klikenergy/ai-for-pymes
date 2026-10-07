import assert from "node:assert/strict";
import { test } from "node:test";
import { SolicitudSchema, calLinkDe, notasParaCalcom } from "./solicitud";

const base = {
  nombre: "Mónica",
  empresa: "Golosita",
  correo: " Monica@Golosita.CO ",
  whatsapp: "+57 310 320 8950",
};

test("SolicitudSchema: lo mínimo basta y normaliza el correo", () => {
  const r = SolicitudSchema.parse(base);
  assert.equal(r.correo, "monica@golosita.co");
  assert.equal(r.sedes, null);
  assert.deepEqual(r.canales, []);
  assert.equal(r.usa_shopify, null);
  assert.equal(r.mensajes_dia, null);
});

test("SolicitudSchema rechaza correo, WhatsApp y canales inválidos", () => {
  assert.equal(SolicitudSchema.safeParse({ ...base, correo: "no-es-correo" }).success, false);
  assert.equal(SolicitudSchema.safeParse({ ...base, whatsapp: "abc" }).success, false);
  assert.equal(SolicitudSchema.safeParse({ ...base, canales: ["tiktok"] }).success, false);
  assert.equal(SolicitudSchema.safeParse({ ...base, sedes: "0" }).success, false);
});

test("calLinkDe acepta el link corto o la URL completa", () => {
  assert.equal(calLinkDe("felrick/demo"), "felrick/demo");
  assert.equal(calLinkDe("https://cal.com/felrick/demo"), "felrick/demo");
  assert.equal(calLinkDe("https://app.cal.com/felrick/demo/"), "felrick/demo");
  assert.equal(calLinkDe(""), null);
  assert.equal(calLinkDe(undefined), null);
  assert.equal(calLinkDe("felrick/demo?x=<script>"), null);
});

test("notasParaCalcom resume solo lo que se llenó", () => {
  const datos = SolicitudSchema.parse({
    ...base,
    sedes: "3",
    canales: ["whatsapp", "instagram"],
    usa_shopify: true,
    mensajes_dia: "100-500",
  });
  const notas = notasParaCalcom(datos);
  assert.match(notas, /Empresa: Golosita/);
  assert.match(notas, /Sedes: 3/);
  assert.match(notas, /Canales: WhatsApp, Instagram/);
  assert.match(notas, /Shopify: sí/);
  assert.match(notas, /Mensajes al día: Entre 100 y 500/);
  assert.doesNotMatch(notas, /Sector/);
});
