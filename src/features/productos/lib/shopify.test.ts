import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claveOpcion,
  mapearProductoShopify,
  normalizarTienda,
  precioEntero,
  resumenImportacion,
} from "./shopify";

test("normalizarTienda solo acepta dominios *.myshopify.com", () => {
  assert.equal(normalizarTienda("golosita"), "golosita.myshopify.com");
  assert.equal(normalizarTienda(" Golosita.myshopify.com "), "golosita.myshopify.com");
  assert.equal(normalizarTienda("https://golosita.myshopify.com/admin/products"), "golosita.myshopify.com");
  assert.equal(normalizarTienda("golosita.co"), null);
  assert.equal(normalizarTienda("https://golosita.co"), null);
  assert.equal(normalizarTienda("evil.com/x.myshopify.com"), null);
  assert.equal(normalizarTienda("golosita.myshopify.com.evil.com"), null);
  assert.equal(normalizarTienda(""), null);
});

test("claveOpcion lleva los nombres comunes a sabor y tamano", () => {
  assert.equal(claveOpcion("Sabor"), "sabor");
  assert.equal(claveOpcion("Flavor"), "sabor");
  assert.equal(claveOpcion("Tamaño"), "tamano");
  assert.equal(claveOpcion("Size"), "tamano");
  assert.equal(claveOpcion("Color del topper"), "color_del_topper");
});

test("precioEntero redondea y deja 0 lo vacío o inválido", () => {
  assert.equal(precioEntero("69000.00"), 69000);
  assert.equal(precioEntero("8500.5"), 8501);
  assert.equal(precioEntero(0), 0);
  assert.equal(precioEntero(null), 0);
  assert.equal(precioEntero("abc"), 0);
});

test("mapearProductoShopify arma producto y variantes; Default Title = sin opciones", () => {
  const p = mapearProductoShopify({
    id: "gid://shopify/Product/1",
    handle: "golofit",
    title: " GoloFit ",
    productType: "Saludable",
    description: "Sin azúcar añadido",
    status: "ACTIVE",
    featuredMedia: { preview: { image: { url: "https://cdn.shopify.com/a.jpg" } } },
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/11",
          price: "69000.00",
          sku: "GF6",
          selectedOptions: [
            { name: "Tamaño", value: "6 porciones" },
            { name: "Sabor", value: "Vainilla" },
          ],
        },
      ],
    },
  });
  assert.equal(p.nombre, "GoloFit");
  assert.equal(p.categoria, "Saludable");
  assert.deepEqual(p.imagenes, ["https://cdn.shopify.com/a.jpg"]);
  assert.equal(p.activo, true);
  assert.deepEqual(p.variantes[0], {
    external_id: "gid://shopify/ProductVariant/11",
    opciones: { tamano: "6 porciones", sabor: "Vainilla" },
    precio: 69000,
    sku: "GF6",
  });

  const unica = mapearProductoShopify({
    id: "gid://shopify/Product/2",
    handle: "golobox",
    title: "Golobox",
    status: "DRAFT",
    variants: {
      nodes: [
        { id: "v", price: "0.00", sku: "", selectedOptions: [{ name: "Title", value: "Default Title" }] },
      ],
    },
  });
  assert.equal(unica.activo, false);
  assert.deepEqual(unica.variantes[0].opciones, {});
  assert.equal(unica.variantes[0].precio, 0);
  assert.equal(unica.variantes[0].sku, null);
  assert.deepEqual(unica.imagenes, []);
});

test("resumenImportacion menciona solo lo que pasó", () => {
  assert.equal(resumenImportacion({ creados: 3, actualizados: 0 }), "3 nuevos · 0 actualizados");
  assert.match(
    resumenImportacion({ creados: 0, actualizados: 2, sin_tocar_por_edicion: 1, variantes_precio_cero: 4 }),
    /1 sin tocar.*4 variantes en \$0/,
  );
});
