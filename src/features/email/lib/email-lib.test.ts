import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { escapeHtml, renderLayout, renderText } from "./layout.ts";
import { elegirDestinatarios } from "./destinatarios.ts";
import { tokenBaja, urlBaja, verificarBaja } from "./baja.ts";
import { emailBrand, emailSender } from "./config.ts";

const brand = {
  name: "Felrick",
  logoUrl: null,
  color: "#a3e635",
  colorText: "#1a2e05",
  appUrl: "https://app.test",
};

test("escapa el HTML de los datos (un nombre no puede inyectar etiquetas)", () => {
  assert.equal(escapeHtml(`<b>"Ana" & 'Leo'</b>`), "&lt;b&gt;&quot;Ana&quot; &amp; &#39;Leo&#39;&lt;/b&gt;");
  const html = renderLayout({
    brand,
    preheader: "x",
    title: "<script>alert(1)</script>",
    paragraphs: ["línea 1\nlínea 2"],
    footerNote: "pie",
  });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("línea 1<br>línea 2"));
});

test("el texto plano lleva el botón y la baja", () => {
  const t = renderText({
    brand,
    preheader: "x",
    title: "Pedido nuevo",
    paragraphs: ["Hola"],
    cta: { label: "Ver", url: "https://app.test/pedidos" },
    unsubscribeUrl: "https://app.test/api/email/baja?u=1",
    footerNote: "pie",
  });
  assert.match(t, /Ver: https:\/\/app\.test\/pedidos/);
  assert.match(t, /Dejar de recibir estos correos: https:\/\/app\.test\/api\/email\/baja/);
});

test("destinatarios: solo miembros activos que activaron ese tipo, sin repetir", () => {
  const ws = "w1";
  const prefs = [
    { user_id: "a", workspace_id: ws, activo: true, tipos: ["pedido_nuevo"] },
    { user_id: "b", workspace_id: ws, activo: false, tipos: ["pedido_nuevo"] },
    { user_id: "c", workspace_id: ws, activo: true, tipos: ["handoff"] },
    { user_id: "d", workspace_id: ws, activo: true, tipos: ["pedido_nuevo"] },
    { user_id: "e", workspace_id: "otro", activo: true, tipos: ["pedido_nuevo"] },
  ];
  const miembro = (user_id: string, email: string | null, is_active = true, workspace_id = ws) => ({
    user_id, workspace_id, email, full_name: null, is_active,
  });
  const miembros = [
    miembro("a", " Ana@Golosita.co "),
    miembro("a", "ana@golosita.co"),
    miembro("b", "b@x.co"),
    miembro("c", "c@x.co"),
    miembro("d", "d@x.co", false),
    miembro("e", "e@x.co", true, "otro"),
    miembro("f", "no-es-correo"),
  ];
  assert.deepEqual(elegirDestinatarios(ws, "pedido_nuevo", prefs, miembros), [
    { userId: "a", email: "ana@golosita.co", nombre: null },
  ]);
  assert.deepEqual(elegirDestinatarios(ws, "handoff", prefs, miembros).map((d) => d.userId), ["c"]);
});

test("baja: el token es por usuario y workspace; sin secreto no hay enlace", () => {
  const prev = { e: process.env.EMAIL_UNSUBSCRIBE_SECRET, c: process.env.CRON_SECRET };
  delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal(tokenBaja("u", "w"), null);
  assert.equal(verificarBaja("u", "w", "x"), false);

  process.env.EMAIL_UNSUBSCRIBE_SECRET = "k".repeat(32);
  const t = tokenBaja("u", "w")!;
  assert.ok(verificarBaja("u", "w", t));
  assert.equal(verificarBaja("u", "otro", t), false);
  assert.equal(verificarBaja("otro", "w", t), false);
  assert.match(urlBaja("https://app.test", "u", "w") ?? "", /^https:\/\/app\.test\/api\/email\/baja\?u=u&w=w&t=/);

  if (prev.e === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET; else process.env.EMAIL_UNSUBSCRIBE_SECRET = prev.e;
  if (prev.c === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev.c;
});

test("baja: una clave de ejemplo o corta no firma enlaces", () => {
  const prev = { e: process.env.EMAIL_UNSUBSCRIBE_SECRET, c: process.env.CRON_SECRET };
  delete process.env.CRON_SECRET;
  for (const ejemplo of ["<aleatorio>", "your-unsubscribe-secret", "corta", "<" + "x".repeat(40) + ">"]) {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = ejemplo;
    assert.equal(tokenBaja("u", "w"), null, ejemplo);
    // Con la clave pública de la documentación no se puede fabricar un enlace.
    const forjado = createHmac("sha256", ejemplo).update("baja:u:w").digest("base64url");
    assert.equal(verificarBaja("u", "w", forjado), false, ejemplo);
  }

  if (prev.e === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET; else process.env.EMAIL_UNSUBSCRIBE_SECRET = prev.e;
  if (prev.c === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev.c;
});

test("baja: sin clave propia usa una derivada de CRON_SECRET, no CRON_SECRET tal cual", () => {
  const prev = { e: process.env.EMAIL_UNSUBSCRIBE_SECRET, c: process.env.CRON_SECRET };
  delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  process.env.CRON_SECRET = "c".repeat(64);
  const t = tokenBaja("u", "w")!;
  assert.ok(verificarBaja("u", "w", t));
  const conCronDirecto = createHmac("sha256", "c".repeat(64)).update("baja:u:w").digest("base64url");
  assert.notEqual(t, conCronDirecto);
  assert.equal(verificarBaja("u", "w", conCronDirecto), false);

  if (prev.e === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET; else process.env.EMAIL_UNSUBSCRIBE_SECRET = prev.e;
  if (prev.c === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev.c;
});

test("config: sin EMAIL_FROM no hay remitente; colores inválidos usan los de la marca", () => {
  const prev = { ...process.env };
  delete process.env.EMAIL_FROM;
  assert.equal(emailSender(), null);
  process.env.EMAIL_FROM = "avisos@aiforpymes.co";
  assert.deepEqual(emailSender(), { from: "avisos@aiforpymes.co", fromName: "Felrick", replyTo: null });
  process.env.EMAIL_BRAND_COLOR = "red";
  process.env.EMAIL_LOGO_URL = "http://inseguro/logo.png";
  const b = emailBrand();
  assert.equal(b.color, "#a3e635");
  assert.equal(b.logoUrl, null);
  process.env = prev;
});
