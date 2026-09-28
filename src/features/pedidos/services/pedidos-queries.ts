// Lecturas de la pantalla Pedidos. Usan el cliente del usuario (anon key +
// sesión), así que RLS limita todo a los workspaces donde es miembro.

import type { SupabaseClient } from "@supabase/supabase-js";
import { esEstadoPedido } from "../lib/estados";
import { esFechaValida, hoyEnZona, rangoDelDia } from "../lib/fechas";
import type {
  PagoPorVerificar,
  PedidoFila,
  SedeResumen,
  VistaPedidos,
} from "../types";

const ZONA_POR_DEFECTO = "America/Bogota";

function zonaValida(z: unknown): string {
  if (typeof z !== "string" || !z) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

function uno<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function cargarVistaPedidos(
  supabase: SupabaseClient,
  workspaceId: string,
  filtros: { fecha?: string; sede?: string },
): Promise<VistaPedidos> {
  const [{ data: reglaZona }, { data: sedesData }] = await Promise.all([
    supabase
      .from("reglas_negocio")
      .select("valor")
      .eq("workspace_id", workspaceId)
      .eq("clave", "zona_horaria")
      .maybeSingle(),
    supabase
      .from("sedes")
      .select("id, codigo, nombre")
      .eq("workspace_id", workspaceId)
      .eq("activa", true)
      .order("nombre"),
  ]);

  const zona = zonaValida(reglaZona?.valor);
  const fecha = esFechaValida(filtros.fecha) ? filtros.fecha : hoyEnZona(zona);
  const sedes = (sedesData ?? []) as SedeResumen[];
  const sede = sedes.find((s) => s.codigo === filtros.sede) ?? null;
  const { desde, hasta } = rangoDelDia(fecha, zona);

  let qPedidos = supabase
    .from("pedidos")
    .select(
      "id, numero, estado, nombre_cliente, telefono, linea, sabor, tamano, cantidad, detalle, " +
        "modalidad, direccion_entrega, fecha_entrega, total, anticipo_requerido, pagado, saldo, " +
        "precio_validado, conversation_id, notas, sedes(id, codigo, nombre)",
    )
    .eq("workspace_id", workspaceId)
    .gte("fecha_entrega", desde)
    .lt("fecha_entrega", hasta)
    .order("fecha_entrega", { ascending: true });
  if (sede) qPedidos = qPedidos.eq("sede_id", sede.id);

  const qPagos = supabase
    .from("pagos_pedido")
    .select(
      "id, tipo, monto_esperado, monto_reportado, referencia, banco, fecha_pago, descripcion_ia, " +
        "created_at, media, message_id, " +
        "pedidos(id, numero, nombre_cliente, fecha_entrega, total, conversation_id, sedes(nombre))",
    )
    .eq("workspace_id", workspaceId)
    .eq("estado", "por_verificar")
    .order("created_at", { ascending: true })
    .limit(50);

  const [{ data: pedidosData, error: ePed }, { data: pagosData, error: ePag }] =
    await Promise.all([qPedidos, qPagos]);

  if (ePed) console.error("[pedidos] lectura de pedidos:", ePed.message);
  if (ePag) console.error("[pedidos] lectura de pagos:", ePag.message);

  const pedidos: PedidoFila[] = ((pedidosData ?? []) as unknown[]).flatMap(
    (raw) => {
      const r = raw as Record<string, unknown>;
      if (!esEstadoPedido(r.estado)) return [];
      return [
        {
          ...(r as unknown as PedidoFila),
          detalle: (r.detalle as Record<string, string>) ?? {},
          sede: uno(r.sedes as SedeResumen | SedeResumen[] | null),
        },
      ];
    },
  );

  // El archivo del comprobante: messages.meta.storage_path lo escribe el
  // descargador de medios después de recibir el mensaje, así que se lee aquí
  // (y no la copia de pagos_pedido.media, que puede haber quedado vacía).
  const pagosRaw = (pagosData ?? []) as unknown as Array<
    Record<string, unknown> & { message_id: string | null }
  >;
  const messageIds = pagosRaw
    .map((p) => p.message_id)
    .filter((id): id is string => !!id);

  const metaPorMensaje = new Map<string, Record<string, unknown>>();
  if (messageIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, meta")
      .eq("workspace_id", workspaceId)
      .in("id", messageIds);
    for (const m of (msgs ?? []) as { id: string; meta: Record<string, unknown> | null }[]) {
      metaPorMensaje.set(m.id, m.meta ?? {});
    }
  }

  const pagos: PagoPorVerificar[] = pagosRaw.map((p) => {
    const meta = p.message_id ? metaPorMensaje.get(p.message_id) : undefined;
    const media = (p.media as Record<string, unknown> | null) ?? {};
    const ped = uno(p.pedidos as Record<string, unknown> | Record<string, unknown>[] | null);
    const sedePed = ped ? uno(ped.sedes as { nombre: string } | { nombre: string }[] | null) : null;
    return {
      id: p.id as string,
      tipo: p.tipo as PagoPorVerificar["tipo"],
      monto_esperado: p.monto_esperado as number,
      monto_reportado: (p.monto_reportado as number | null) ?? null,
      referencia: (p.referencia as string | null) ?? null,
      banco: (p.banco as string | null) ?? null,
      fecha_pago: (p.fecha_pago as string | null) ?? null,
      descripcion_ia:
        (p.descripcion_ia as string | null) ??
        (typeof meta?.description === "string" ? meta.description : null),
      created_at: p.created_at as string,
      storage_path:
        (typeof meta?.storage_path === "string" && meta.storage_path) ||
        (typeof media.storage_path === "string" && media.storage_path) ||
        null,
      mime_type:
        (typeof meta?.mime_type === "string" && meta.mime_type) ||
        (typeof media.mime_type === "string" && media.mime_type) ||
        null,
      pedido: ped
        ? {
            id: ped.id as string,
            numero: ped.numero as string,
            nombre_cliente: ped.nombre_cliente as string,
            fecha_entrega: ped.fecha_entrega as string,
            total: ped.total as number,
            sede_nombre: sedePed?.nombre ?? null,
            conversation_id: (ped.conversation_id as string | null) ?? null,
          }
        : null,
    };
  });

  return {
    zona,
    fecha,
    sedeCodigo: sede?.codigo ?? null,
    sedes,
    pedidos,
    pagos,
  };
}
