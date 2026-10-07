import assert from "node:assert/strict";
import { test } from "node:test";
import { coordenada, enlaceMaps, textoUbicacion } from "./ubicacion";

test("coordenada acepta número o texto y rechaza fuera de rango", () => {
  assert.equal(coordenada("4.142000", 90), 4.142);
  assert.equal(coordenada(-73.626, 180), -73.626);
  assert.equal(coordenada(91, 90), null);
  assert.equal(coordenada(null, 90), null);
  assert.equal(coordenada("abc", 180), null);
});

test("textoUbicacion: con coordenadas agrega el enlace de Maps", () => {
  assert.equal(
    textoUbicacion({ sede: "Golosita Caudal", direccion: "Calle 45 # 31-08", latitud: 4.142, longitud: -73.626 }),
    `📍 *Golosita Caudal*\nCalle 45 # 31-08\n${enlaceMaps(4.142, -73.626)}`,
  );
});

test("textoUbicacion: sin coordenadas solo la dirección en texto", () => {
  assert.equal(
    textoUbicacion({ sede: "Golosita Buque", direccion: "Local 1, San José Plaza", latitud: null, longitud: null }),
    "📍 *Golosita Buque*\nLocal 1, San José Plaza",
  );
});
