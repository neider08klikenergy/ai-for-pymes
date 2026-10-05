// Lecturas de la pantalla Productos. Usan el cliente del usuario (anon key +
// sesión), así que RLS limita todo a los workspaces donde es miembro.

import type { SupabaseClient } from "@supabase/supabase-js";
import { esFechaValida, hoyEnZona } from "@/features/pedidos/lib/fechas";
import { zonaValida } from "@/features/pedidos/services/pedidos-queries";
import type {
  FilaDisponibilidad,
  Producto,
  SedeCatalogo,
  Variante,
  VistaProductos,
} from "../lib/catalogo";

export interface ParamsProductos {
  vista?: string;
  sede?: string;
  fecha?: string;
}

export interface PantallaProductos {
  vista: VistaProductos;
  productos: Producto[];
  sedes: SedeCatalogo[];
  /** Sede y fecha del menú del día. */
  sedeId: string | null;
  fecha: string;
  hoy: string;
  /** Menú de esa sede y fecha, por variante. */
  menu: Record<string, FilaDisponibilidad>;
  error: string | null;
}

const SELECT_PRODUCTO =
  "id, slug, nombre, categoria, descripcion, imagenes, modo_disponibilidad, activo, origen, orden, " +
  "producto_variantes(id, producto_id, opciones, porciones, incluye, precio, validado, activa, orden)";

export async function cargarPantallaProductos(
  supabase: SupabaseClient,
  workspaceId: string,
  params: ParamsProductos,
): Promise<PantallaProductos> {
  const [productosRes, sedesRes, zonaRes] = await Promise.all([
    supabase
      .from("productos")
      .select(SELECT_PRODUCTO)
      .eq("workspace_id", workspaceId)
      .order("orden")
      .order("nombre"),
    supabase
      .from("sedes")
      .select("id, codigo, nombre")
      .eq("workspace_id", workspaceId)
      .eq("activa", true)
      .order("nombre"),
    supabase
      .from("reglas_negocio")
      .select("valor")
      .eq("workspace_id", workspaceId)
      .eq("clave", "zona_horaria")
      .maybeSingle(),
  ]);

  const hoy = hoyEnZona(zonaValida(zonaRes.data?.valor));
  const sedes = (sedesRes.data ?? []) as SedeCatalogo[];
  const vista: VistaProductos = params.vista === "menu" ? "menu" : "catalogo";
  const fecha = esFechaValida(params.fecha) ? params.fecha : hoy;
  const sedeId = sedes.find((s) => s.id === params.sede)?.id ?? sedes[0]?.id ?? null;

  const productos = ((productosRes.data ?? []) as unknown as (Omit<Producto, "variantes"> & {
    producto_variantes: Variante[] | null;
  })[]).map(({ producto_variantes, ...p }) => ({
    ...p,
    imagenes: Array.isArray(p.imagenes) ? p.imagenes : [],
    variantes: (producto_variantes ?? []).sort(
      (a, b) => a.orden - b.orden || a.precio - b.precio,
    ),
  }));

  const menu: Record<string, FilaDisponibilidad> = {};
  if (vista === "menu" && sedeId) {
    const { data } = await supabase
      .from("disponibilidad_sede")
      .select("variante_id, disponible, cantidad")
      .eq("workspace_id", workspaceId)
      .eq("sede_id", sedeId)
      .eq("fecha", fecha);
    for (const f of (data ?? []) as FilaDisponibilidad[]) menu[f.variante_id] = f;
  }

  return {
    vista,
    productos,
    sedes,
    sedeId,
    fecha,
    hoy,
    menu,
    error: productosRes.error ? "No se pudo cargar el catálogo." : null,
  };
}
