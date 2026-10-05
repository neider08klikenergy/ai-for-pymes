// Catálogo de productos del workspace: tipos, validación y helpers puros.
// La tabla interna es la fuente de verdad (Shopify, cuando llegue, solo importa).

import { z } from "zod";

export const MODOS = ["siempre", "por_dia", "bajo_pedido"] as const;
export type ModoDisponibilidad = (typeof MODOS)[number];

export const MODO_LABEL: Record<ModoDisponibilidad, string> = {
  siempre: "Siempre disponible",
  por_dia: "Menú del día",
  bajo_pedido: "Bajo pedido",
};

export const MODO_AYUDA: Record<ModoDisponibilidad, string> = {
  siempre: "Se vende en el horario de la sede. La sede puede marcarlo agotado un día.",
  por_dia: "Solo se ofrece si la sede lo carga en el menú de ese día, con o sin cantidad.",
  bajo_pedido: "Se hace por encargo: aplica la anticipación mínima y el cupo diario.",
};

export interface Variante {
  id: string;
  producto_id: string;
  opciones: Record<string, string>;
  porciones: string | null;
  incluye: string | null;
  precio: number;
  validado: boolean;
  activa: boolean;
  orden: number;
}

export interface Producto {
  id: string;
  slug: string;
  nombre: string;
  categoria: string | null;
  descripcion: string | null;
  imagenes: string[];
  modo_disponibilidad: ModoDisponibilidad;
  activo: boolean;
  origen: "manual" | "shopify";
  orden: number;
  variantes: Variante[];
}

export interface SedeCatalogo {
  id: string;
  codigo: string;
  nombre: string;
}

/** Fila del menú del día: una variante en una sede y fecha. */
export interface FilaDisponibilidad {
  variante_id: string;
  disponible: boolean;
  cantidad: number | null;
}

/** "Red Velvet · 1/2 lb". Sabor y tamaño primero; el resto en orden alfabético. */
export function nombreVariante(opciones: Record<string, string>): string {
  const { sabor, tamano, ...resto } = opciones;
  const extra = Object.keys(resto)
    .sort()
    .map((k) => resto[k]);
  return [sabor, tamano, ...extra].filter((v) => v && v.trim()).join(" · ") || "Única";
}

/** "Ponqué Personalizado" → "ponque_personalizado" (igual que cat_slug en SQL). */
export function slugProducto(nombre: string): string {
  return nombre
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Estado efectivo de una variante en el menú de un día:
 * - siempre: disponible salvo que la sede lo marque.
 * - por_dia: no disponible hasta que la sede lo cargue.
 * - bajo_pedido: no usa menú del día.
 */
export function disponibleEnMenu(
  modo: ModoDisponibilidad,
  fila: FilaDisponibilidad | undefined,
): boolean {
  if (modo === "bajo_pedido") return true;
  if (!fila) return modo === "siempre";
  return fila.disponible && fila.cantidad !== 0;
}

/** Agrupa por categoría (las sin categoría al final), respetando el orden de entrada. */
export function agruparPorCategoria(productos: Producto[]): [string, Producto[]][] {
  const grupos = new Map<string, Producto[]>();
  for (const p of productos) {
    const c = p.categoria?.trim() || "Sin categoría";
    grupos.set(c, [...(grupos.get(c) ?? []), p]);
  }
  return [...grupos.entries()].sort(([a], [b]) =>
    a === "Sin categoría" ? 1 : b === "Sin categoría" ? -1 : 0,
  );
}

/** Filtro de la búsqueda: nombre, categoría u opciones de alguna variante. */
export function coincideBusqueda(p: Producto, q: string): boolean {
  const t = slugProducto(q);
  if (!t) return true;
  const textos = [p.nombre, p.categoria ?? "", p.slug, ...p.variantes.map((v) => nombreVariante(v.opciones))];
  return textos.some((x) => slugProducto(x).includes(t));
}

// ── Validación (la usan las acciones del servidor) ───────────────────────────

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const ProductoSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  nombre: z.string().trim().min(2, "Escribe el nombre del producto").max(120),
  slug: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v ?? ""),
  categoria: textoOpcional(60),
  descripcion: textoOpcional(1000),
  imagenes: z
    .array(z.string().trim().url("Una de las imágenes no es un enlace válido").max(1000))
    .max(10, "Máximo 10 imágenes")
    .default([]),
  modo_disponibilidad: z.enum(MODOS),
  activo: z.boolean(),
  orden: z.coerce.number().int().min(0).max(9999).default(0),
  /** Solo al crear: precio de la variante única (productos sin sabores ni tamaños). */
  precio_inicial: z
    .union([z.literal(""), z.null(), z.coerce.number().int("El precio va sin decimales").min(0).max(100_000_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

const OPCION = /^[a-z_]{1,30}$/;

export const VarianteSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  producto_id: z.string().uuid(),
  opciones: z
    .record(z.string(), z.string().trim().max(60))
    .transform((o) =>
      Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "")),
    )
    .refine((o) => Object.keys(o).every((k) => OPCION.test(k)), "Nombre de opción no válido")
    .refine((o) => Object.keys(o).length <= 5, "Máximo 5 opciones por variante"),
  porciones: textoOpcional(40),
  incluye: textoOpcional(300),
  precio: z.coerce.number().int("El precio va sin decimales").min(0, "El precio no puede ser negativo").max(100_000_000),
  validado: z.boolean(),
  activa: z.boolean(),
  orden: z.coerce.number().int().min(0).max(9999).default(0),
});

export const DisponibilidadSchema = z.object({
  variante_id: z.string().uuid(),
  sede_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
  disponible: z.boolean(),
  cantidad: z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(0, "La cantidad no puede ser negativa").max(100_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

export type ProductoInput = z.input<typeof ProductoSchema>;
export type VarianteInput = z.input<typeof VarianteSchema>;
export type DisponibilidadInput = z.input<typeof DisponibilidadSchema>;

export function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos no válidos";
}

// ── URL de la pantalla ───────────────────────────────────────────────────────

export type VistaProductos = "catalogo" | "menu";

export function urlProductos(p: { vista: VistaProductos; sede?: string | null; fecha?: string }): string {
  const q = new URLSearchParams();
  if (p.vista === "menu") {
    q.set("vista", "menu");
    if (p.sede) q.set("sede", p.sede);
    if (p.fecha) q.set("fecha", p.fecha);
  }
  const s = q.toString();
  return s ? `/productos?${s}` : "/productos";
}
