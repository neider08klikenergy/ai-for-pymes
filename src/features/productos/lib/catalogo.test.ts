import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DisponibilidadSchema,
  ProductoSchema,
  VarianteSchema,
  agruparPorCategoria,
  coincideBusqueda,
  disponibleEnMenu,
  nombreVariante,
  slugProducto,
  urlProductos,
  type Producto,
} from "./catalogo";

const producto = (p: Partial<Producto>): Producto => ({
  id: "p1",
  slug: "golovesa",
  nombre: "Golovesa",
  categoria: "Tortas frías",
  descripcion: null,
  imagenes: [],
  modo_disponibilidad: "por_dia",
  activo: true,
  origen: "manual",
  orden: 0,
  variantes: [],
  ...p,
});

test("nombreVariante pone sabor y tamaño primero y las demás opciones en orden", () => {
  assert.equal(nombreVariante({ tamano: "1/2 lb", sabor: "Red Velvet" }), "Red Velvet · 1/2 lb");
  assert.equal(nombreVariante({ tamano: "porcion" }), "porcion");
  assert.equal(nombreVariante({ sabor: "Vainilla", relleno: "Arequipe", color: "Rosa" }), "Vainilla · Rosa · Arequipe");
  assert.equal(nombreVariante({}), "Única");
});

test("slugProducto coincide con cat_slug de SQL", () => {
  assert.equal(slugProducto("Ponqué Personalizado"), "ponque_personalizado");
  assert.equal(slugProducto("  Golovesa  "), "golovesa");
  assert.equal(slugProducto("Mini-Éclair (x10)"), "mini_eclair_x10");
});

test("disponibleEnMenu: siempre sin fila sí, por_dia sin fila no, cantidad 0 agotado", () => {
  assert.equal(disponibleEnMenu("siempre", undefined), true);
  assert.equal(disponibleEnMenu("por_dia", undefined), false);
  assert.equal(disponibleEnMenu("por_dia", { variante_id: "v", disponible: true, cantidad: null }), true);
  assert.equal(disponibleEnMenu("por_dia", { variante_id: "v", disponible: true, cantidad: 0 }), false);
  assert.equal(disponibleEnMenu("siempre", { variante_id: "v", disponible: false, cantidad: null }), false);
  assert.equal(disponibleEnMenu("bajo_pedido", undefined), true);
});

test("agruparPorCategoria deja 'Sin categoría' al final", () => {
  const grupos = agruparPorCategoria([
    producto({ id: "a", categoria: null }),
    producto({ id: "b", categoria: "Ponqués" }),
    producto({ id: "c", categoria: "Ponqués" }),
  ]);
  assert.deepEqual(
    grupos.map(([c, l]) => [c, l.map((p) => p.id)]),
    [
      ["Ponqués", ["b", "c"]],
      ["Sin categoría", ["a"]],
    ],
  );
});

test("coincideBusqueda busca en nombre y en las opciones de las variantes, sin tildes", () => {
  const p = producto({
    variantes: [
      {
        id: "v",
        producto_id: "p1",
        opciones: { sabor: "Tiramisú", tamano: "personal" },
        porciones: null,
        incluye: null,
        precio: 52000,
        validado: false,
        activa: true,
        orden: 0,
      },
    ],
  });
  assert.equal(coincideBusqueda(p, "tiramisu"), true);
  assert.equal(coincideBusqueda(p, "frías"), true);
  assert.equal(coincideBusqueda(p, "red velvet"), false);
  assert.equal(coincideBusqueda(p, "  "), true);
});

test("ProductoSchema: imágenes deben ser URL y el precio inicial vacío es null", () => {
  const ok = ProductoSchema.safeParse({
    nombre: "Helado",
    modo_disponibilidad: "siempre",
    activo: true,
    imagenes: ["https://cdn.example.com/h.jpg"],
    precio_inicial: "",
  });
  assert.ok(ok.success);
  assert.equal(ok.data.precio_inicial, null);
  assert.equal(ok.data.categoria, null);
  const mal = ProductoSchema.safeParse({ nombre: "Helado", modo_disponibilidad: "siempre", activo: true, imagenes: ["no-es-url"] });
  assert.equal(mal.success, false);
});

test("VarianteSchema quita opciones vacías y rechaza precios con decimales", () => {
  const ok = VarianteSchema.safeParse({
    producto_id: "8b0e3c1e-3f43-4b4e-9d0c-0a7c4f9a1b2c",
    opciones: { sabor: "", tamano: "1/2 lb" },
    precio: "150000",
    validado: true,
    activa: true,
  });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.opciones, { tamano: "1/2 lb" });
  assert.equal(ok.data.precio, 150000);
  const mal = VarianteSchema.safeParse({
    producto_id: "8b0e3c1e-3f43-4b4e-9d0c-0a7c4f9a1b2c",
    opciones: {},
    precio: "1500.5",
    validado: true,
    activa: true,
  });
  assert.equal(mal.success, false);
});

test("DisponibilidadSchema: cantidad vacía = sin contar", () => {
  const r = DisponibilidadSchema.parse({
    variante_id: "8b0e3c1e-3f43-4b4e-9d0c-0a7c4f9a1b2c",
    sede_id: "8b0e3c1e-3f43-4b4e-9d0c-0a7c4f9a1b2d",
    fecha: "2026-10-05",
    disponible: true,
    cantidad: "",
  });
  assert.equal(r.cantidad, null);
});

test("urlProductos solo lleva sede y fecha en el menú del día", () => {
  assert.equal(urlProductos({ vista: "catalogo", sede: "s", fecha: "2026-10-05" }), "/productos");
  assert.equal(urlProductos({ vista: "menu", sede: "s", fecha: "2026-10-05" }), "/productos?vista=menu&sede=s&fecha=2026-10-05");
});
