import assert from "node:assert/strict";
import { test } from "node:test";
import { rutaImagenPropia, rutaNuevaImagen, rutasParaBorrar } from "./imagenes";

const SB = "https://abc.supabase.co";
const WS = "11111111-1111-4111-8111-111111111111";
const propia = (archivo: string, ws = WS) =>
  `${SB}/storage/v1/object/public/productos-imagenes/${ws}/${archivo}`;

test("rutaImagenPropia reconoce solo fotos de nuestro bucket", () => {
  assert.equal(rutaImagenPropia(propia("a.jpg"), SB), `${WS}/a.jpg`);
  assert.equal(rutaImagenPropia("https://cdn.shopify.com/s/files/a.jpg", SB), null);
  assert.equal(rutaImagenPropia("https://otro.supabase.co/storage/v1/object/public/productos-imagenes/x/a.jpg", SB), null);
  assert.equal(rutaImagenPropia(`${SB}/storage/v1/object/public/whatsapp-media/${WS}/a.jpg`, SB), null);
  assert.equal(rutaImagenPropia("no es url", SB), null);
  assert.equal(rutaImagenPropia(propia("a.jpg"), undefined), null);
});

test("rutaNuevaImagen pone el workspace primero", () => {
  assert.equal(rutaNuevaImagen(WS, "x", "image/png"), `${WS}/x.png`);
  assert.equal(rutaNuevaImagen(WS, "x", "image/jpeg"), `${WS}/x.jpg`);
});

test("rutasParaBorrar: solo las propias de este workspace que se quitaron", () => {
  const otroWs = "22222222-2222-4222-8222-222222222222";
  const antes = [propia("a.jpg"), propia("b.jpg"), "https://cdn.shopify.com/c.jpg", propia("d.jpg", otroWs)];
  const despues = [propia("b.jpg")];
  assert.deepEqual(rutasParaBorrar(antes, despues, WS, SB), [`${WS}/a.jpg`]);
  assert.deepEqual(rutasParaBorrar(antes, antes, WS, SB), []);
});
