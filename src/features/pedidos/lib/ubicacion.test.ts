import assert from "node:assert/strict";
import { test } from "node:test";
import { coordenada, enlaceMaps, leerCoordenadas, separarPar, textoUbicacion } from "./ubicacion";

test("separarPar reconoce el par que copia Google Maps", () => {
  assert.deepEqual(separarPar("4.142000, -73.626000"), { latitud: "4.142000", longitud: "-73.626000" });
  assert.deepEqual(separarPar("4.142 -73.626"), { latitud: "4.142", longitud: "-73.626" });
  assert.equal(separarPar("4.142"), null);
  assert.equal(separarPar("4,142"), null);
  assert.equal(separarPar("calle 45"), null);
});

test("leerCoordenadas: vacías, válidas (con coma decimal) o con error", () => {
  assert.deepEqual(leerCoordenadas("", " "), { tipo: "vacia" });
  assert.deepEqual(leerCoordenadas("4.1420004", "-73,626"), { tipo: "ok", latitud: 4.142, longitud: -73.626 });
  assert.equal(leerCoordenadas("4.142", "").tipo, "error");
  assert.equal(leerCoordenadas("abc", "-73.6").tipo, "error");
  assert.equal(leerCoordenadas("95", "-73.6").tipo, "error");
  assert.equal(leerCoordenadas("4.1", "-190").tipo, "error");
});

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
