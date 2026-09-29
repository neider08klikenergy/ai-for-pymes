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
import { avisarCliente, TEXTO_AVISO, type ResultadoAviso } from "./notificar";

export type ResultadoAccion =
  | { ok: true; mensaje: string; aviso: ResultadoAviso; avisoTexto: string | null }
  | { ok: false; error: string };

const MENSAJES_RPC: Record<string, string> = {
  PAGO_NO_EXISTE: "Ese pago ya no existe.",
  NO_AUTORIZADO: "No tienes permiso para revisar pagos.",
  PAGO_YA_REVISADO: "Otra persona ya revisó este pago.",
};

const Aviso = z.string().trim().max(4096).nullable();

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
    .select("workspace_id, pedidos(conversation_id)")
    .eq("id", parsed.data.pagoId)
    .maybeSingle();
  if (!pago) return { ok: false, error: MENSAJES_RPC.PAGO_NO_EXISTE };

  const acceso = await checkWorkspaceMember(pago.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: MENSAJES_RPC.NO_AUTORIZADO };

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
  const aviso = await avisarCliente({
    workspaceId: pago.workspace_id as string,
    conversationId,
    texto: parsed.data.aviso,
    userId: acceso.userId,
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
