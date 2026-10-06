"use server";

// Acciones de la pantalla Productos. Van con el cliente del usuario:
// RLS solo deja editar el catálogo a admin y manager (productos_write,
// producto_variantes_write) y el menú del día también al rol agent
// (disponibilidad_sede_write). checkWorkspaceMember lo revisa antes para dar
// un mensaje claro. Las FK compuestas (workspace_id, id) impiden apuntar a
// filas de otro workspace.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sumarDias } from "@/features/pedidos/lib/fechas";
import { createClient as svcClient } from "@supabase/supabase-js";
import { checkWorkspaceMember, type WorkspaceRole } from "@/lib/auth/workspace-access";
import { resumenImportacion } from "../lib/shopify";
import { ShopifyError, cargarConfigShopify, leerProductosShopify } from "./shopify-client";
import {
  DisponibilidadSchema,
  ProductoSchema,
  VarianteSchema,
  primerError,
  slugProducto,
} from "../lib/catalogo";

export type ResultadoProducto =
  | { ok: true; id?: string; copiados?: number; resumen?: string }
  | { ok: false; error: string };

const Uuid = z.string().uuid();
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function permiso(workspaceId: string, minRole: WorkspaceRole): Promise<ResultadoProducto> {
  if (!Uuid.safeParse(workspaceId).success) return { ok: false, error: "Workspace no válido" };
  const acceso = await checkWorkspaceMember(workspaceId, { minRole });
  if (acceso.ok) return { ok: true };
  return {
    ok: false,
    error:
      minRole === "agent"
        ? "No tienes permiso para cambiar el menú del día"
        : "Solo un admin o manager puede cambiar el catálogo",
  };
}

function listo(extra: Omit<Extract<ResultadoProducto, { ok: true }>, "ok"> = {}): ResultadoProducto {
  revalidatePath("/productos");
  return { ok: true, ...extra };
}

function errorDeBase(message: string | undefined): string {
  if (message?.includes("productos_workspace_id_slug_key")) {
    return "Ya existe un producto con ese código";
  }
  if (message?.includes("uq_variantes_opciones")) {
    return "Ya existe una variante con esas mismas opciones";
  }
  return "No se pudo guardar. Intenta de nuevo.";
}

// ── Productos ────────────────────────────────────────────────────────────────

export async function guardarProducto(workspaceId: string, input: unknown): Promise<ResultadoProducto> {
  const p = await permiso(workspaceId, "manager");
  if (!p.ok) return p;
  const parsed = ProductoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const { id, slug, precio_inicial, ...datos } = parsed.data;
  const codigo = slugProducto(slug || datos.nombre);
  if (!codigo) return { ok: false, error: "El código del producto no es válido" };

  const supabase = await createClient();
  // editado_localmente: si el producto vino de Shopify, la reimportación no pisa este cambio
  const fila = { ...datos, slug: codigo, editado_localmente: true };
  const { data, error } = id
    ? await supabase
        .from("productos")
        .update(fila)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("productos")
        .insert({ ...fila, workspace_id: workspaceId })
        .select("id")
        .single();

  if (error || !data) {
    if (error) console.error("[productos] guardarProducto:", error.message);
    return { ok: false, error: error ? errorDeBase(error.message) : "Producto no encontrado" };
  }

  // Un producto nuevo con precio queda vendible con una variante única
  if (!id && precio_inicial !== null) {
    const { error: eVar } = await supabase.from("producto_variantes").insert({
      workspace_id: workspaceId,
      producto_id: data.id,
      opciones: {},
      precio: precio_inicial,
      validado: true,
    });
    if (eVar) console.error("[productos] variante inicial:", eVar.message);
  }
  return listo({ id: data.id as string });
}

export async function borrarProducto(workspaceId: string, productoId: string): Promise<ResultadoProducto> {
  const p = await permiso(workspaceId, "manager");
  if (!p.ok) return p;
  if (!Uuid.safeParse(productoId).success) return { ok: false, error: "Producto no válido" };

  const supabase = await createClient();
  // Los pedidos guardan linea/sabor/tamaño como texto: borrar no los afecta.
  const { error } = await supabase
    .from("productos")
    .delete()
    .eq("id", productoId)
    .eq("workspace_id", workspaceId);
  if (error) {
    console.error("[productos] borrarProducto:", error.message);
    return { ok: false, error: "No se pudo borrar. Intenta de nuevo." };
  }
  return listo();
}

// ── Variantes ────────────────────────────────────────────────────────────────

export async function guardarVariante(workspaceId: string, input: unknown): Promise<ResultadoProducto> {
  const p = await permiso(workspaceId, "manager");
  if (!p.ok) return p;
  const parsed = VarianteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const { id, ...datos } = parsed.data;
  const supabase = await createClient();
  const fila = { ...datos, editado_localmente: true };
  const { data, error } = id
    ? await supabase
        .from("producto_variantes")
        .update(fila)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("producto_variantes")
        .insert({ ...fila, workspace_id: workspaceId })
        .select("id")
        .single();

  if (error || !data) {
    if (error) console.error("[productos] guardarVariante:", error.message);
    return { ok: false, error: error ? errorDeBase(error.message) : "Variante no encontrada" };
  }
  return listo({ id: data.id as string });
}

export async function borrarVariante(workspaceId: string, varianteId: string): Promise<ResultadoProducto> {
  const p = await permiso(workspaceId, "manager");
  if (!p.ok) return p;
  if (!Uuid.safeParse(varianteId).success) return { ok: false, error: "Variante no válida" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("producto_variantes")
    .delete()
    .eq("id", varianteId)
    .eq("workspace_id", workspaceId);
  if (error) {
    console.error("[productos] borrarVariante:", error.message);
    return { ok: false, error: "No se pudo borrar. Intenta de nuevo." };
  }
  return listo();
}

// ── Menú del día ─────────────────────────────────────────────────────────────

export async function guardarDisponibilidad(workspaceId: string, input: unknown): Promise<ResultadoProducto> {
  const p = await permiso(workspaceId, "agent");
  if (!p.ok) return p;
  const parsed = DisponibilidadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("disponibilidad_sede").upsert(
    { ...parsed.data, workspace_id: workspaceId, actualizado_por: user?.id ?? null },
    { onConflict: "variante_id,sede_id,fecha" },
  );
  if (error) {
    console.error("[productos] guardarDisponibilidad:", error.message);
    return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  }
  // Sin revalidar: la pantalla ya muestra el cambio y recargarla quitaría el
  // foco mientras el personal escribe cantidades.
  return { ok: true };
}

/**
 * Carga en `fecha` los mismos productos que estaban disponibles el día
 * anterior en esa sede, sin cantidades (las unidades cambian cada día).
 * No toca lo que ya esté cargado en `fecha`.
 */
export async function copiarMenuDiaAnterior(
  workspaceId: string,
  sedeId: string,
  fecha: string,
): Promise<ResultadoProducto> {
  const p = await permiso(workspaceId, "agent");
  if (!p.ok) return p;
  if (!Uuid.safeParse(sedeId).success || !Fecha.safeParse(fecha).success) {
    return { ok: false, error: "Sede o fecha no válida" };
  }

  const supabase = await createClient();
  const [{ data: ayer, error: e1 }, { data: hoy, error: e2 }] = await Promise.all([
    supabase
      .from("disponibilidad_sede")
      .select("variante_id, disponible")
      .eq("workspace_id", workspaceId)
      .eq("sede_id", sedeId)
      .eq("fecha", sumarDias(fecha, -1)),
    supabase
      .from("disponibilidad_sede")
      .select("variante_id")
      .eq("workspace_id", workspaceId)
      .eq("sede_id", sedeId)
      .eq("fecha", fecha),
  ]);
  if (e1 || e2) return { ok: false, error: "No se pudo leer el menú. Intenta de nuevo." };

  const yaCargadas = new Set((hoy ?? []).map((f) => f.variante_id as string));
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const nuevas = (ayer ?? [])
    .filter((f) => f.disponible && !yaCargadas.has(f.variante_id as string))
    .map((f) => ({
      workspace_id: workspaceId,
      variante_id: f.variante_id as string,
      sede_id: sedeId,
      fecha,
      disponible: true,
      cantidad: null,
      actualizado_por: user?.id ?? null,
    }));
  if (nuevas.length === 0) return listo({ copiados: 0 });

  const { error } = await supabase.from("disponibilidad_sede").insert(nuevas);
  if (error) {
    console.error("[productos] copiarMenuDiaAnterior:", error.message);
    return { ok: false, error: "No se pudo copiar el menú. Intenta de nuevo." };
  }
  return listo({ copiados: nuevas.length });
}

// ── Shopify ──────────────────────────────────────────────────────────────────

/**
 * Trae todos los productos de la tienda Shopify del workspace al catálogo.
 * No pisa lo editado en el panel (ver cat_importar_shopify).
 */
export async function importarDesdeShopify(workspaceId: string): Promise<ResultadoProducto> {
  const p = await permiso(workspaceId, "manager");
  if (!p.ok) return p;

  const cfg = await cargarConfigShopify(workspaceId).catch(() => null);
  if (!cfg) {
    return { ok: false, error: "Conecta la tienda en Settings → Integraciones → Shopify." };
  }

  try {
    const productos = await leerProductosShopify(cfg);
    if (productos.length === 0) {
      return { ok: false, error: "Shopify no devolvió productos. No se cambió nada en el catálogo." };
    }
    // La función solo la ejecuta el service role; el rol ya se revisó arriba.
    const svc = svcClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await svc.rpc("cat_importar_shopify", {
      p_ws: workspaceId,
      p_productos: productos,
      p_completo: true,
    });
    if (error || !data?.ok) {
      console.error("[productos] importarDesdeShopify:", error?.message ?? data?.error);
      return { ok: false, error: "No se pudo guardar la importación. Intenta de nuevo." };
    }
    return listo({ resumen: resumenImportacion(data) });
  } catch (err) {
    if (err instanceof ShopifyError) return { ok: false, error: err.message };
    console.error("[productos] importarDesdeShopify:", err instanceof Error ? err.message : err);
    return { ok: false, error: "No se pudo importar desde Shopify. Intenta de nuevo." };
  }
}
