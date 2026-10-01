"use server";

// Acciones del equipo sobre pedidos y pagos. Van con el cliente del usuario:
// RLS (pedidos_update) y pd_confirmar_pago revisan el rol en la base de datos;
// checkWorkspaceMember lo revisa antes para dar un mensaje claro.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMember } from "@/lib/auth/workspace-access";
import {
  ESTADOS_PEDIDO,
  ESTADO_LABEL,
  esEstadoPedido,
  transicionPermitida,
} from "../lib/estados";
import type { DatosAviso } from "../lib/mensajes";
import { PLANTILLAS, parametrosPlantilla, type EventoPlantilla } from "../lib/plantillas";
import { avisarCliente, TEXTO_AVISO, type PlantillaAviso, type ResultadoAviso } from "./notificar";

export type ResultadoAccion =
  | { ok: true; mensaje: string; aviso: ResultadoAviso; avisoTexto: string | null }
  | { ok: false; error: string };

const MENSAJES_RPC: Record<string, string> = {
  PAGO_NO_EXISTE: "Ese pago ya no existe.",
  NO_AUTORIZADO: "No tienes permiso para hacer esto.",
  PAGO_YA_REVISADO: "Otra persona ya revisó este pago.",
  PEDIDO_NO_ENCONTRADO: "Pedido no encontrado.",
  NO_SE_PUEDE_CANCELAR: "Ese pedido ya está entregado o cancelado.",
  PEDIDO_CERRADO: "Ese pedido ya está entregado o cancelado.",
  PEDIDO_PAGADO: "Ese pedido ya está pagado.",
  SIN_SALDO_A_FAVOR: "El cliente no tiene saldo a favor vigente.",
};

const Aviso = z.string().trim().max(4096).nullable();

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Datos del pedido (leídos de la base, no del navegador) para armar la
 * plantilla que se usa si la ventana de 24 h está cerrada.
 */
async function plantillaPara(
  supabase: Supa,
  pedidoId: string,
  evento: EventoPlantilla,
  extra: Parameters<typeof parametrosPlantilla>[3] = {},
): Promise<PlantillaAviso | null> {
  const { data: p } = await supabase
    .from("pedidos")
    .select("workspace_id, numero, nombre_cliente, fecha_entrega, modalidad, total, pagado, sedes(nombre)")
    .eq("id", pedidoId)
    .maybeSingle();
  if (!p) return null;
  const { data: regla } = await supabase
    .from("reglas_negocio")
    .select("valor")
    .eq("workspace_id", p.workspace_id)
    .eq("clave", "zona_horaria")
    .maybeSingle();
  const zona = typeof regla?.valor === "string" ? regla.valor : "America/Bogota";
  const sede = p.sedes as { nombre: string } | { nombre: string }[] | null;
  const datos: DatosAviso = {
    numero: p.numero as string,
    nombre_cliente: p.nombre_cliente as string,
    fecha_entrega: p.fecha_entrega as string,
    sede_nombre: (Array.isArray(sede) ? sede[0]?.nombre : sede?.nombre) ?? null,
    modalidad: p.modalidad as DatosAviso["modalidad"],
    total: p.total as number,
    pagado: p.pagado as number,
  };
  try {
    return {
      nombre: PLANTILLAS[evento].nombre,
      parametros: parametrosPlantilla(evento, datos, zona, extra),
    };
  } catch {
    return null;
  }
}

// ── Cambiar estado del pedido ────────────────────────────────────────────────

const CambioEstadoSchema = z.object({
  pedidoId: z.string().uuid(),
  hacia: z.enum(ESTADOS_PEDIDO),
  aviso: Aviso,
});

export async function cambiarEstadoPedido(input: {
  pedidoId: string;
  hacia: string;
  /** Texto para el cliente; null o vacío = no avisar. */
  aviso?: string | null;
}): Promise<ResultadoAccion> {
  const parsed = CambioEstadoSchema.safeParse({ ...input, aviso: input.aviso ?? null });
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id, workspace_id, numero, estado, conversation_id")
    .eq("id", parsed.data.pedidoId)
    .maybeSingle();

  if (!pedido || !esEstadoPedido(pedido.estado)) {
    return { ok: false, error: "Pedido no encontrado" };
  }

  const acceso = await checkWorkspaceMember(pedido.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) {
    return { ok: false, error: "No tienes permiso para cambiar pedidos" };
  }

  if (parsed.data.hacia === "cancelado") {
    return { ok: false, error: "Para cancelar usa la opción Cancelar pedido" };
  }
  if (!transicionPermitida(pedido.estado, parsed.data.hacia)) {
    return {
      ok: false,
      error: `No se puede pasar de "${ESTADO_LABEL[pedido.estado]}" a "${ESTADO_LABEL[parsed.data.hacia]}"`,
    };
  }

  // Condición sobre el estado actual: si alguien lo cambió en paralelo, no pisa.
  const { data: actualizado, error } = await supabase
    .from("pedidos")
    .update({ estado: parsed.data.hacia, updated_at: new Date().toISOString() })
    .eq("id", pedido.id)
    .eq("estado", pedido.estado)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[pedidos] cambiarEstadoPedido:", error.message);
    return { ok: false, error: "No se pudo actualizar el pedido" };
  }
  if (!actualizado) {
    return { ok: false, error: "El pedido cambió mientras tanto. Recarga la página." };
  }

  // El estado ya cambió: el aviso es aparte y nunca deshace el cambio.
  const aviso = await avisarCliente({
    workspaceId: pedido.workspace_id as string,
    conversationId: (pedido.conversation_id as string | null) ?? null,
    texto: parsed.data.aviso,
    userId: acceso.userId,
    plantilla:
      parsed.data.aviso && parsed.data.hacia === "listo"
        ? await plantillaPara(supabase, pedido.id as string, "listo")
        : null,
  });

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: `${pedido.numero}: ${ESTADO_LABEL[parsed.data.hacia]}`,
    aviso,
    avisoTexto: TEXTO_AVISO[aviso],
  };
}

// ── Confirmar o rechazar un comprobante ──────────────────────────────────────

const RevisionSchema = z.object({
  pagoId: z.string().uuid(),
  aprobar: z.boolean(),
  monto: z.number().int().min(1).max(100_000_000).nullable(),
  motivo: z.string().trim().max(300).nullable(),
  aviso: Aviso,
});

export async function revisarPago(input: {
  pagoId: string;
  aprobar: boolean;
  monto?: number | null;
  motivo?: string | null;
  /** Texto para el cliente; null o vacío = no avisar. */
  aviso?: string | null;
}): Promise<ResultadoAccion> {
  const parsed = RevisionSchema.safeParse({
    pagoId: input.pagoId,
    aprobar: input.aprobar,
    monto: input.monto ?? null,
    motivo: input.motivo?.trim() ? input.motivo : null,
    aviso: input.aviso ?? null,
  });
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };
  if (!parsed.data.aprobar && !parsed.data.motivo) {
    return { ok: false, error: "Escribe el motivo del rechazo" };
  }

  const supabase = await createClient();
  const { data: pago } = await supabase
    .from("pagos_pedido")
    .select("workspace_id, pedido_id, pedidos(conversation_id)")
    .eq("id", parsed.data.pagoId)
    .maybeSingle();
  if (!pago) return { ok: false, error: MENSAJES_RPC.PAGO_NO_EXISTE };

  const acceso = await checkWorkspaceMember(pago.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: MENSAJES_RPC.NO_AUTORIZADO };

  const plantillaRevision = parsed.data.aviso
    ? await plantillaPara(
        supabase,
        pago.pedido_id as string,
        parsed.data.aprobar ? "pago_confirmado" : "pago_rechazado",
        { monto: parsed.data.monto ?? undefined, motivo: parsed.data.motivo ?? undefined },
      )
    : null;

  const { data, error } = await supabase.rpc("pd_confirmar_pago", {
    p_pago_id: parsed.data.pagoId,
    p_aprobar: parsed.data.aprobar,
    p_monto: parsed.data.monto,
    p_motivo: parsed.data.motivo,
  });

  if (error) {
    console.error("[pedidos] revisarPago:", error.message);
    return { ok: false, error: "No se pudo registrar la revisión" };
  }

  const r = (data ?? {}) as { ok?: boolean; error?: string; numero?: string };
  if (!r.ok) {
    return {
      ok: false,
      error: MENSAJES_RPC[r.error ?? ""] ?? "No se pudo registrar la revisión",
    };
  }

  const ped = pago.pedidos as { conversation_id: string | null } | { conversation_id: string | null }[] | null;
  const conversationId = (Array.isArray(ped) ? ped[0] : ped)?.conversation_id ?? null;
  // La plantilla se arma con el pedido ANTES del pago (pagado aún sin este monto).
  const aviso = await avisarCliente({
    workspaceId: pago.workspace_id as string,
    conversationId,
    texto: parsed.data.aviso,
    userId: acceso.userId,
    plantilla: parsed.data.aviso ? plantillaRevision : null,
  });

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: parsed.data.aprobar
      ? `Pago confirmado${r.numero ? ` · ${r.numero}` : ""}`
      : "Pago rechazado",
    aviso,
    avisoTexto: TEXTO_AVISO[aviso],
  };
}

// ── Cancelar (con saldo a favor) ─────────────────────────────────────────────

const CancelarSchema = z.object({
  pedidoId: z.string().uuid(),
  generarSaldo: z.boolean(),
  motivo: z.string().trim().max(300).nullable(),
  aviso: Aviso,
});

export async function cancelarPedido(input: {
  pedidoId: string;
  /** Deja lo pagado como saldo a favor del cliente. */
  generarSaldo: boolean;
  motivo?: string | null;
  aviso?: string | null;
}): Promise<ResultadoAccion> {
  const parsed = CancelarSchema.safeParse({
    pedidoId: input.pedidoId,
    generarSaldo: input.generarSaldo,
    motivo: input.motivo?.trim() ? input.motivo : null,
    aviso: input.aviso ?? null,
  });
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id, workspace_id, conversation_id")
    .eq("id", parsed.data.pedidoId)
    .maybeSingle();
  if (!pedido) return { ok: false, error: MENSAJES_RPC.PEDIDO_NO_ENCONTRADO };

  const acceso = await checkWorkspaceMember(pedido.workspace_id as string, { minRole: "agent" });
  if (!acceso.ok) return { ok: false, error: MENSAJES_RPC.NO_AUTORIZADO };

  const { data, error } = await supabase.rpc("pd_cancelar_pedido", {
    p_pedido_id: parsed.data.pedidoId,
    p_generar_saldo: parsed.data.generarSaldo,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    console.error("[pedidos] cancelarPedido:", error.message);
    return { ok: false, error: "No se pudo cancelar el pedido" };
  }
  const r = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    numero?: string;
    saldo_generado?: number;
    vence_at?: string | null;
  };
  if (!r.ok) return { ok: false, error: MENSAJES_RPC[r.error ?? ""] ?? "No se pudo cancelar el pedido" };

  const vence = r.vence_at
    ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" }).format(
        new Date(r.vence_at),
      )
    : "";
  const aviso = await avisarCliente({
    workspaceId: pedido.workspace_id as string,
    conversationId: (pedido.conversation_id as string | null) ?? null,
    texto: parsed.data.aviso,
    userId: acceso.userId,
    plantilla: parsed.data.aviso
      ? await plantillaPara(supabase, parsed.data.pedidoId, "cancelado", {
          saldoFavor: r.saldo_generado ? { monto: r.saldo_generado, vence } : undefined,
        })
      : null,
  });

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: r.saldo_generado
      ? `${r.numero}: cancelado · saldo a favor de $${r.saldo_generado.toLocaleString("es-CO")}`
      : `${r.numero}: cancelado`,
    aviso,
    avisoTexto: TEXTO_AVISO[aviso],
  };
}

// ── Pagar con saldo a favor ──────────────────────────────────────────────────

export async function aplicarSaldoFavor(pedidoId: string): Promise<ResultadoAccion> {
  if (!z.string().uuid().safeParse(pedidoId).success) {
    return { ok: false, error: "Datos no válidos" };
  }
  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("workspace_id")
    .eq("id", pedidoId)
    .maybeSingle();
  if (!pedido) return { ok: false, error: MENSAJES_RPC.PEDIDO_NO_ENCONTRADO };

  const acceso = await checkWorkspaceMember(pedido.workspace_id as string, { minRole: "agent" });
  if (!acceso.ok) return { ok: false, error: MENSAJES_RPC.NO_AUTORIZADO };

  const { data, error } = await supabase.rpc("pd_aplicar_saldo", {
    p_pedido_id: pedidoId,
    p_monto: null,
  });
  if (error) {
    console.error("[pedidos] aplicarSaldoFavor:", error.message);
    return { ok: false, error: "No se pudo aplicar el saldo a favor" };
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; numero?: string; aplicado?: number };
  if (!r.ok) return { ok: false, error: MENSAJES_RPC[r.error ?? ""] ?? "No se pudo aplicar el saldo" };

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: `${r.numero}: se aplicaron $${(r.aplicado ?? 0).toLocaleString("es-CO")} de saldo a favor`,
    aviso: "sin_aviso",
    avisoTexto: null,
  };
}

// ── Cupo de personalizados de un día ─────────────────────────────────────────

const CupoDiaSchema = z.object({
  sedeId: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Cupo automático de ese día; null = el de la sede. */
  cupo: z.number().int().min(0).max(500).nullable(),
  cerrado: z.boolean(),
  nota: z.string().trim().max(200).nullable().optional(),
});

/**
 * Abre cupo extra, cierra cupos o vuelve al cupo normal de la sede para un
 * día. Lo hace el equipo de la tienda (RLS cupos_dia_write: admin, manager,
 * agent).
 */
export async function ajustarCupoDia(input: {
  sedeId: string;
  fecha: string;
  cupo: number | null;
  cerrado: boolean;
  nota?: string | null;
}): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  const parsed = CupoDiaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };
  const { sedeId, fecha, cupo, cerrado } = parsed.data;
  const nota = parsed.data.nota?.trim() || null;

  const supabase = await createClient();
  const { data: sede } = await supabase
    .from("sedes")
    .select("id, workspace_id, nombre")
    .eq("id", sedeId)
    .maybeSingle();
  if (!sede) return { ok: false, error: "Sede no encontrada" };

  const acceso = await checkWorkspaceMember(sede.workspace_id as string, { minRole: "agent" });
  if (!acceso.ok) return { ok: false, error: "No tienes permiso para cambiar cupos" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sin ajuste: se borra la fila y queda el cupo normal de la sede.
  const { error } =
    cupo === null && !cerrado
      ? await supabase.from("cupos_dia").delete().eq("sede_id", sedeId).eq("fecha", fecha)
      : await supabase.from("cupos_dia").upsert(
          {
            workspace_id: sede.workspace_id,
            sede_id: sedeId,
            fecha,
            cupo,
            cerrado,
            nota,
            updated_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "sede_id,fecha" },
        );
  if (error) {
    console.error("[pedidos] ajustar cupo:", error.message);
    return { ok: false, error: "No se pudo guardar el cupo" };
  }

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: cerrado
      ? "Cupos cerrados para ese día"
      : cupo === null
        ? "Cupo normal de la sede"
        : `Cupo del día: ${cupo}`,
  };
}
