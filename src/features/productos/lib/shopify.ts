// Shopify → catálogo: helpers puros (sin red). El cliente HTTP está en
// services/shopify-client.ts y la escritura en la función SQL
// cat_importar_shopify (migración 20261011000001).

import { slugProducto } from "./catalogo";

/** Producto listo para cat_importar_shopify. */
export interface ProductoShopify {
  external_id: string;
  handle: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  imagenes: string[];
  activo: boolean;
  variantes: {
    external_id: string;
    opciones: Record<string, string>;
    precio: number;
    sku: string | null;
  }[];
}

/** Nodo de producto tal como lo pide PRODUCTOS_QUERY. */
export interface NodoProductoShopify {
  id: string;
  handle: string;
  title: string;
  productType?: string | null;
  description?: string | null;
  status?: string | null;
  featuredMedia?: { preview?: { image?: { url?: string | null } | null } | null } | null;
  variants?: {
    nodes?: {
      id: string;
      price?: string | number | null;
      sku?: string | null;
      selectedOptions?: { name: string; value: string }[] | null;
    }[];
  } | null;
}

/**
 * Dominio de la tienda en Shopify ("golosita.myshopify.com").
 * Acepta "golosita", "golosita.myshopify.com" o una URL del admin. Un
 * dominio propio (golosita.co) no sirve: la Admin API solo responde en
 * *.myshopify.com, y limitarlo a ese dominio evita llamadas a otros hosts.
 */
export function normalizarTienda(entrada: string): string | null {
  let t = entrada.trim().toLowerCase();
  t = t.replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? "";
  if (/^[a-z0-9][a-z0-9-]*$/.test(t)) t = `${t}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(t) ? t : null;
}

const CLAVES_OPCION: Record<string, string> = {
  sabor: "sabor",
  sabores: "sabor",
  flavor: "sabor",
  flavour: "sabor",
  tamano: "tamano",
  tamanos: "tamano",
  size: "tamano",
  talla: "tamano",
  presentacion: "tamano",
  porciones: "tamano",
};

/** "Sabor" → sabor, "Size" → tamano, "Color" → color. */
export function claveOpcion(nombre: string): string {
  const s = slugProducto(nombre).replace(/\//g, "_");
  return CLAVES_OPCION[s] ?? (s.slice(0, 30) || "opcion");
}

/** Precio de Shopify ("69000.00") a entero en la moneda local. */
export function precioEntero(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function mapearProductoShopify(n: NodoProductoShopify): ProductoShopify {
  const imagen = n.featuredMedia?.preview?.image?.url;
  return {
    external_id: n.id,
    handle: n.handle,
    nombre: n.title.trim(),
    categoria: n.productType?.trim() || null,
    descripcion: n.description?.trim().slice(0, 1000) || null,
    imagenes: imagen ? [imagen] : [],
    activo: (n.status ?? "ACTIVE") === "ACTIVE",
    variantes: (n.variants?.nodes ?? []).map((v) => {
      const opciones: Record<string, string> = {};
      for (const o of v.selectedOptions ?? []) {
        // "Title: Default Title" es la variante única de Shopify: sin opciones
        if (o.name === "Title" && o.value === "Default Title") continue;
        const valor = o.value.trim();
        if (valor) opciones[claveOpcion(o.name)] = valor.slice(0, 60);
      }
      return {
        external_id: v.id,
        opciones,
        precio: precioEntero(v.price),
        sku: v.sku?.trim() || null,
      };
    }),
  };
}

/** Texto corto para el aviso después de importar. */
export function resumenImportacion(r: {
  creados?: number;
  actualizados?: number;
  sin_tocar_por_edicion?: number;
  variantes_precio_cero?: number;
  desactivados?: number;
}): string {
  const partes = [
    `${r.creados ?? 0} nuevos`,
    `${r.actualizados ?? 0} actualizados`,
  ];
  if (r.sin_tocar_por_edicion) partes.push(`${r.sin_tocar_por_edicion} sin tocar (editados en el panel)`);
  if (r.desactivados) partes.push(`${r.desactivados} desactivados (ya no están en Shopify)`);
  if (r.variantes_precio_cero) partes.push(`${r.variantes_precio_cero} variantes en $0 quedaron inactivas`);
  return partes.join(" · ");
}
