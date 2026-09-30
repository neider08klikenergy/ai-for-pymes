// Lecturas de la pantalla Pedidos. Usan el cliente del usuario (anon key +
// sesión), así que RLS limita todo a los workspaces donde es miembro.

import type { SupabaseClient } from "@supabase/supabase-js";
import { esEstadoPedido } from "../lib/estados";
import { hoyEnZona, rangoDelDia, semanasDelMes } from "../lib/fechas";
import { leerFiltros, type ParamsPedidos } from "../lib/filtros";
import type {
  PagoPorVerificar,
  PagoResumen,
  PedidoFila,
  SedeResumen,
  VistaPedidos,
} from "../types";

const ZONA_POR_DEFECTO = "America/Bogota";
const LIMITE_PEDIDOS = 300;

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

function ventanaAbierta(conv: unknown): boolean | null {
  const c = uno(conv as { window_expires_at: string | null } | null);
  if (!c) return null;
  if (!c.window_expires_at) return true;
  return new Date(c.window_expires_at) > new Date();
}

/** Escapa los comodines de LIKE y lo que rompería el filtro .or() de PostgREST. */
function textoBusqueda(q: string): string {
  return q.replace(/[%_\\]/g, "\\$&").replace(/[,()*"]/g, " ").trim();
}

const SELECT_PEDIDO =
  "id, contact_id, numero, estado, nombre_cliente, telefono, linea, sabor, tamano, cantidad, detalle, " +
  "modalidad, direccion_entrega, valor_domicilio, domicilio_origen, fecha_entrega, total, anticipo_requerido, pagado, saldo, " +
  "precio_validado, conversation_id, notas, created_at, sedes(id, codigo, nombre), " +
  "conversations(window_expires_at), " +
  "pagos_pedido(id, tipo, estado, monto_esperado, monto_reportado, referencia, motivo_rechazo, created_at), " +
  "saldos_favor(monto_inicial, monto_disponible, vence_at, estado)";

/** Solo dígitos: +57 320… y 57320… son el mismo cliente. */
function tel(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d || null;
}

function numeroRegla(v: unknown, porDefecto: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
}

function aPedidoFila(raw: unknown): PedidoFila | null {
  const r = raw as Record<string, unknown>;
  if (!esEstadoPedido(r.estado)) return null;
  const pagos = ((r.pagos_pedido as PagoResumen[] | null) ?? []).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  return {
    ...(r as unknown as PedidoFila),
    detalle: (r.detalle as Record<string, string>) ?? {},
    sede: uno(r.sedes as SedeResumen | SedeResumen[] | null),
    ventana_abierta: ventanaAbierta(r.conversations),
    pagos,
    saldo_favor_generado: uno(r.saldos_favor as PedidoFila["saldo_favor_generado"] | PedidoFila["saldo_favor_generado"][]),
    saldo_favor_cliente: 0,
  };
}

export async function cargarVistaPedidos(
  supabase: SupabaseClient,
  workspaceId: string,
  params: ParamsPedidos,
): Promise<VistaPedidos> {
  const [{ data: reglasData }, { data: sedesData }, { count: pagosPendientes }] =
    await Promise.all([
      supabase
        .from("reglas_negocio")
        .select("clave, valor")
        .eq("workspace_id", workspaceId)
        .in("clave", ["zona_horaria", "cancelacion_dias_calendario", "saldo_favor_meses"]),
      supabase
        .from("sedes")
        .select("id, codigo, nombre")
        .eq("workspace_id", workspaceId)
        .eq("activa", true)
        .order("nombre"),
      supabase
        .from("pagos_pedido")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("estado", "por_verificar"),
    ]);

  const regla = (clave: string) =>
    (reglasData ?? []).find((r: { clave: string }) => r.clave === clave)?.valor as unknown;
  const zona = zonaValida(regla("zona_horaria"));
  const reglas = {
    cancelacionDias: numeroRegla(regla("cancelacion_dias_calendario"), 3),
    saldoFavorMeses: numeroRegla(regla("saldo_favor_meses"), 6),
  };
  const hoy = hoyEnZona(zona);
  const filtros = leerFiltros(params, hoy);
  const sedes = (sedesData ?? []) as SedeResumen[];
  const sede = sedes.find((s) => s.codigo === filtros.sede) ?? null;
  filtros.sede = sede?.codigo ?? null;

  const base: VistaPedidos = {
    zona,
    hoy,
    filtros,
    sedes,
    pedidos: [],
    pagos: [],
    pagosPendientes: pagosPendientes ?? 0,
    truncado: false,
    reglas,
  };

  if (filtros.vista === "pagos") {
    return { ...base, pagos: await cargarPagos(supabase, workspaceId) };
  }

  // Rango de fechas: el de los filtros (tabla) o el de la cuadrícula del mes.
  let desdeDia = filtros.desde;
  let hastaDia = filtros.hasta;
  if (filtros.vista === "calendario") {
    const semanas = semanasDelMes(filtros.mes);
    desdeDia = semanas[0][0];
    hastaDia = semanas[semanas.length - 1][6];
  }
  const desde = rangoDelDia(desdeDia, zona).desde;
  const hasta = rangoDelDia(hastaDia, zona).hasta;

  let q = supabase
    .from("pedidos")
    .select(SELECT_PEDIDO)
    .eq("workspace_id", workspaceId)
    .gte("fecha_entrega", desde)
    .lt("fecha_entrega", hasta)
    .order("fecha_entrega", { ascending: true })
    .limit(LIMITE_PEDIDOS + 1);

  if (sede) q = q.eq("sede_id", sede.id);

  if (filtros.vista === "calendario") {
    q = q.neq("estado", "cancelado");
  } else if (filtros.estado === "activos") {
    q = q.not("estado", "in", "(entregado,cancelado)");
  } else if (filtros.estado !== "todos") {
    q = q.eq("estado", filtros.estado);
  }

  const busqueda = filtros.vista === "tabla" ? textoBusqueda(filtros.q) : "";
  if (busqueda) {
    q = q.or(
      `numero.ilike.%${busqueda}%,nombre_cliente.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%`,
    );
  }

  const { data, error } = await q;
  if (error) console.error("[pedidos] lectura de pedidos:", error.message);

  const filas = ((data ?? []) as unknown[])
    .map(aPedidoFila)
    .filter((p): p is PedidoFila => p !== null);

  await sumarSaldosDeClientes(supabase, workspaceId, filas);

  return {
    ...base,
    pedidos: filas.slice(0, LIMITE_PEDIDOS),
    truncado: filas.length > LIMITE_PEDIDOS,
  };
}

async function cargarPagos(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<PagoPorVerificar[]> {
  const { data, error } = await supabase
    .from("pagos_pedido")
    .select(
      "id, tipo, monto_esperado, monto_reportado, referencia, banco, fecha_pago, descripcion_ia, " +
        "created_at, media, message_id, " +
        "pedidos(id, numero, nombre_cliente, fecha_entrega, total, pagado, modalidad, conversation_id, " +
        "sedes(nombre), conversations(window_expires_at))",
    )
    .eq("workspace_id", workspaceId)
    .eq("estado", "por_verificar")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) console.error("[pedidos] lectura de pagos:", error.message);

  // El archivo del comprobante: messages.meta.storage_path lo escribe el
  // descargador de medios después de recibir el mensaje, así que se lee aquí
  // (y no la copia de pagos_pedido.media, que puede haber quedado vacía).
  const pagosRaw = (data ?? []) as unknown as Array<
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

  const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

  return pagosRaw.map((p) => {
    const meta = p.message_id ? metaPorMensaje.get(p.message_id) : undefined;
    const media = (p.media as Record<string, unknown> | null) ?? {};
    const ped = uno(p.pedidos as Record<string, unknown> | Record<string, unknown>[] | null);
    const sedePed = ped ? uno(ped.sedes as { nombre: string } | { nombre: string }[] | null) : null;
    return {
      id: p.id as string,
      tipo: p.tipo as PagoPorVerificar["tipo"],
      monto_esperado: p.monto_esperado as number,
      monto_reportado: (p.monto_reportado as number | null) ?? null,
      referencia: texto(p.referencia),
      banco: texto(p.banco),
      fecha_pago: texto(p.fecha_pago),
      descripcion_ia: texto(p.descripcion_ia) ?? texto(meta?.description),
      created_at: p.created_at as string,
      storage_path: texto(meta?.storage_path) ?? texto(media.storage_path),
      mime_type: texto(meta?.mime_type) ?? texto(media.mime_type),
      pedido: ped
        ? {
            id: ped.id as string,
            numero: ped.numero as string,
            nombre_cliente: ped.nombre_cliente as string,
            fecha_entrega: ped.fecha_entrega as string,
            total: ped.total as number,
            pagado: ped.pagado as number,
            modalidad: ped.modalidad as "recogida" | "domicilio",
            sede_nombre: sedePed?.nombre ?? null,
            conversation_id: (ped.conversation_id as string | null) ?? null,
            ventana_abierta: ventanaAbierta(ped.conversations),
          }
        : null,
    };
  });
}

/**
 * Saldo a favor vigente de cada cliente, para ofrecer usarlo en sus pedidos
 * abiertos. Se busca por contacto de WhatsApp o por teléfono.
 */
async function sumarSaldosDeClientes(
  supabase: SupabaseClient,
  workspaceId: string,
  pedidos: PedidoFila[],
): Promise<void> {
  const abiertos = pedidos.filter(
    (p) => p.saldo > 0 && p.estado !== "cancelado" && p.estado !== "entregado",
  );
  if (abiertos.length === 0) return;

  const { data, error } = await supabase
    .from("saldos_favor")
    .select("contact_id, telefono, monto_disponible")
    .eq("workspace_id", workspaceId)
    .eq("estado", "disponible")
    .gt("monto_disponible", 0)
    .gt("vence_at", new Date().toISOString());
  if (error) {
    // Sin la migración de saldo a favor la tabla no existe: la pantalla sigue.
    console.warn("[pedidos] lectura de saldos a favor:", error.message);
    return;
  }

  const saldos = (data ?? []) as {
    contact_id: string | null;
    telefono: string | null;
    monto_disponible: number;
  }[];
  for (const p of abiertos) {
    const t = tel(p.telefono);
    p.saldo_favor_cliente = saldos
      .filter(
        (s) =>
          (p.contact_id && s.contact_id === p.contact_id) || (t && tel(s.telefono) === t),
      )
      .reduce((acc, s) => acc + s.monto_disponible, 0);
  }
}
