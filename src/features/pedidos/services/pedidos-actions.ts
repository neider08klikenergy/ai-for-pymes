"use server";

// Acciones del equipo sobre pedidos y pagos. Van con el cliente del usuario:
// RLS (pedidos_update) y pd_confirmar_pago revisan el rol en la base de datos;
// checkWorkspaceMember lo revisa antes para dar un mensaje claro.

import {
  ESTADOS_PEDIDO,
  esEstadoPedido,
  transicionPermitida,
} from "../lib/estados";
import {
  PLANTILLAS,
  parametrosPlantilla,
  type EventoPlantilla,
} from "../lib/plantillas";
import {
  TEXTO_AVISO,
  avisarCliente,
  type PlantillaAviso,
  type ResultadoAviso,
} from "./notificar";
import { z } from "zod";
import { pesos } from "../lib/fechas";
import { revalidatePath } from "next/cache";
import type { DatosAviso } from "../lib/mensajes";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMember } from "@/lib/auth/workspace-access";

export type ResultadoAccion =
  | {
      ok: true;
      mensaje: string;
      aviso: ResultadoAviso;
      avisoTexto: string | null;
    }
  | { ok: false; error: string };

// Textos en messages/<idioma>.json → pedidos.acciones.*: las acciones responden
// en el idioma del panel de quien las usa.
type T = Awaited<ReturnType<typeof getTranslations<"pedidos.acciones">>>;

/** Error de una función SQL (código) en el idioma del panel. */
function errorRpc(
  t: T,
  codigo: string | undefined,
  porDefecto: string,
): string {
  return codigo && t.has(`rpc.${codigo}`)
    ? t(`rpc.${codigo}` as "rpc.NO_AUTORIZADO")
    : porDefecto;
}

/** Resultado del aviso al cliente (TEXTO_AVISO dice si hay texto). */
function textoAviso(t: T, aviso: ResultadoAviso): string | null {
  return TEXTO_AVISO[aviso] === null
    ? null
    : t(`aviso.${aviso}` as "aviso.enviado");
}

/** Nombre del estado en el idioma del panel. */
async function nombreEstado(estado: string): Promise<string> {
  const te = await getTranslations("pedidos.estados");
  return te.has(estado) ? te(estado as "listo") : estado;
}

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
    .select(
      "workspace_id, numero, nombre_cliente, fecha_entrega, modalidad, total, pagado, sedes(nombre)",
    )
    .eq("id", pedidoId)
    .maybeSingle();
  if (!p) return null;
  const { data: regla } = await supabase
    .from("reglas_negocio")
    .select("valor")
    .eq("workspace_id", p.workspace_id)
    .eq("clave", "zona_horaria")
    .maybeSingle();
  const zona =
    typeof regla?.valor === "string" ? regla.valor : "America/Bogota";
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
  const t = await getTranslations("pedidos.acciones");
  const parsed = CambioEstadoSchema.safeParse({
    ...input,
    aviso: input.aviso ?? null,
  });
  if (!parsed.success) return { ok: false, error: t("datosNoValidos") };

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id, workspace_id, numero, estado, conversation_id")
    .eq("id", parsed.data.pedidoId)
    .maybeSingle();

  if (!pedido || !esEstadoPedido(pedido.estado)) {
    return { ok: false, error: t("rpc.PEDIDO_NO_ENCONTRADO") };
  }

  const acceso = await checkWorkspaceMember(pedido.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) {
    return { ok: false, error: t("sinPermisoPedidos") };
  }

  if (parsed.data.hacia === "cancelado") {
    return { ok: false, error: t("usaCancelar") };
  }
  if (!transicionPermitida(pedido.estado, parsed.data.hacia)) {
    return {
      ok: false,
      error: t("transicionNoPermitida", {
        desde: await nombreEstado(pedido.estado),
        hacia: await nombreEstado(parsed.data.hacia),
      }),
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
    return { ok: false, error: t("noActualizado") };
  }
  if (!actualizado) {
    return { ok: false, error: t("cambioMientras") };
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
    mensaje: t("estadoCambiado", {
      numero: pedido.numero,
      estado: await nombreEstado(parsed.data.hacia),
    }),
    aviso,
    avisoTexto: textoAviso(t, aviso),
  };
}

// ── Confirmar o rechazar un comprobante ──────────────────────────────────────

const RevisionSchema = z.object({
  pagoId: z.string().uuid(),
  aprobar: z.boolean(),
  monto: z.number().int().min(1).max(100_000_000).nullable(),
  motivo: z.string().trim().max(300).nullable(),
  aviso: Aviso,
  excedenteDestino: z.enum(["saldo_favor", "propina"]).nullable(),
});

const DESTINOS_EXCEDENTE = ["saldo_favor", "propina"] as const;
type DestinoExcedente = (typeof DESTINOS_EXCEDENTE)[number];

export async function revisarPago(input: {
  pagoId: string;
  aprobar: boolean;
  monto?: number | null;
  motivo?: string | null;
  /** Si el cliente pagó de más: qué hacer con el excedente (null = decidir después). */
  excedenteDestino?: DestinoExcedente | null;
  /** Texto para el cliente; null o vacío = no avisar. */
  aviso?: string | null;
}): Promise<ResultadoAccion> {
  const t = await getTranslations("pedidos.acciones");
  const parsed = RevisionSchema.safeParse({
    pagoId: input.pagoId,
    aprobar: input.aprobar,
    monto: input.monto ?? null,
    motivo: input.motivo?.trim() ? input.motivo : null,
    aviso: input.aviso ?? null,
    excedenteDestino: input.excedenteDestino ?? null,
  });
  if (!parsed.success) return { ok: false, error: t("datosNoValidos") };
  if (!parsed.data.aprobar && !parsed.data.motivo) {
    return { ok: false, error: t("motivoRechazo") };
  }

  const supabase = await createClient();
  const { data: pago } = await supabase
    .from("pagos_pedido")
    .select("workspace_id, pedido_id, pedidos(conversation_id)")
    .eq("id", parsed.data.pagoId)
    .maybeSingle();
  if (!pago) return { ok: false, error: t("rpc.PAGO_NO_EXISTE") };

  const acceso = await checkWorkspaceMember(pago.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: t("rpc.NO_AUTORIZADO") };

  const plantillaRevision = parsed.data.aviso
    ? await plantillaPara(
        supabase,
        pago.pedido_id as string,
        parsed.data.aprobar ? "pago_confirmado" : "pago_rechazado",
        {
          monto: parsed.data.monto ?? undefined,
          motivo: parsed.data.motivo ?? undefined,
        },
      )
    : null;

  const { data, error } = await supabase.rpc("pd_confirmar_pago", {
    p_pago_id: parsed.data.pagoId,
    p_aprobar: parsed.data.aprobar,
    p_monto: parsed.data.monto,
    p_motivo: parsed.data.motivo,
    p_excedente_destino: parsed.data.excedenteDestino,
  });

  if (error) {
    console.error("[pedidos] revisarPago:", error.message);
    return { ok: false, error: t("noRevision") };
  }

  const r = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    numero?: string;
    falta_anticipo?: number;
    excedente?: number;
    excedente_destino?: string | null;
  };
  if (!r.ok) {
    return {
      ok: false,
      error: errorRpc(t, r.error, t("noRevision")),
    };
  }
  // Pago que no completa el anticipo: el pedido no quedó confirmado, así que
  // no se usa la plantilla de WhatsApp de pago confirmado ("entrega agendada").
  const faltaAnticipo = parsed.data.aprobar ? (r.falta_anticipo ?? 0) : 0;

  const ped = pago.pedidos as
    | { conversation_id: string | null }
    | { conversation_id: string | null }[]
    | null;
  const conversationId =
    (Array.isArray(ped) ? ped[0] : ped)?.conversation_id ?? null;
  // La plantilla se arma con el pedido ANTES del pago (pagado aún sin este monto).
  const aviso = await avisarCliente({
    workspaceId: pago.workspace_id as string,
    conversationId,
    texto: parsed.data.aviso,
    userId: acceso.userId,
    plantilla: parsed.data.aviso && faltaAnticipo === 0 ? plantillaRevision : null,
  });

  const excedente = parsed.data.aprobar ? (r.excedente ?? 0) : 0;
  const claveExcedente =
    r.excedente_destino === "saldo_favor"
      ? "excedente.saldoFavor"
      : r.excedente_destino === "propina"
        ? "excedente.propina"
        : "excedente.porDecidir";
  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: !parsed.data.aprobar
      ? t("pagoRechazado")
      : faltaAnticipo > 0
        ? t("pagoParcial", { numero: r.numero ?? "", falta: pesos(faltaAnticipo) })
        : excedente > 0
          ? t(claveExcedente, { numero: r.numero ?? "", excedente: pesos(excedente) })
          : r.numero
            ? t("pagoConfirmadoNumero", { numero: r.numero })
            : t("pagoConfirmado"),
    aviso,
    avisoTexto: textoAviso(t, aviso),
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
  const t = await getTranslations("pedidos.acciones");
  const parsed = CancelarSchema.safeParse({
    pedidoId: input.pedidoId,
    generarSaldo: input.generarSaldo,
    motivo: input.motivo?.trim() ? input.motivo : null,
    aviso: input.aviso ?? null,
  });
  if (!parsed.success) return { ok: false, error: t("datosNoValidos") };

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id, workspace_id, conversation_id")
    .eq("id", parsed.data.pedidoId)
    .maybeSingle();
  if (!pedido) return { ok: false, error: t("rpc.PEDIDO_NO_ENCONTRADO") };

  const acceso = await checkWorkspaceMember(pedido.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: t("rpc.NO_AUTORIZADO") };

  const { data, error } = await supabase.rpc("pd_cancelar_pedido", {
    p_pedido_id: parsed.data.pedidoId,
    p_generar_saldo: parsed.data.generarSaldo,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    console.error("[pedidos] cancelarPedido:", error.message);
    return { ok: false, error: t("noCancelado") };
  }
  const r = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    numero?: string;
    saldo_generado?: number;
    vence_at?: string | null;
  };
  if (!r.ok)
    return { ok: false, error: errorRpc(t, r.error, t("noCancelado")) };

  const vence = r.vence_at
    ? new Intl.DateTimeFormat("es-CO", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(r.vence_at))
    : "";
  const aviso = await avisarCliente({
    workspaceId: pedido.workspace_id as string,
    conversationId: (pedido.conversation_id as string | null) ?? null,
    texto: parsed.data.aviso,
    userId: acceso.userId,
    plantilla: parsed.data.aviso
      ? await plantillaPara(supabase, parsed.data.pedidoId, "cancelado", {
          saldoFavor: r.saldo_generado
            ? { monto: r.saldo_generado, vence }
            : undefined,
        })
      : null,
  });

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: r.saldo_generado
      ? t("canceladoConSaldo", {
          numero: r.numero ?? "",
          monto: pesos(r.saldo_generado),
        })
      : t("cancelado", { numero: r.numero ?? "" }),
    aviso,
    avisoTexto: textoAviso(t, aviso),
  };
}

// ── Pagar con saldo a favor ──────────────────────────────────────────────────

export async function aplicarSaldoFavor(
  pedidoId: string,
): Promise<ResultadoAccion> {
  const t = await getTranslations("pedidos.acciones");
  if (!z.string().uuid().safeParse(pedidoId).success) {
    return { ok: false, error: t("datosNoValidos") };
  }
  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("workspace_id")
    .eq("id", pedidoId)
    .maybeSingle();
  if (!pedido) return { ok: false, error: t("rpc.PEDIDO_NO_ENCONTRADO") };

  const acceso = await checkWorkspaceMember(pedido.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: t("rpc.NO_AUTORIZADO") };

  const { data, error } = await supabase.rpc("pd_aplicar_saldo", {
    p_pedido_id: pedidoId,
    p_monto: null,
  });
  if (error) {
    console.error("[pedidos] aplicarSaldoFavor:", error.message);
    return { ok: false, error: t("noSaldo") };
  }
  const r = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    numero?: string;
    aplicado?: number;
  };
  if (!r.ok) return { ok: false, error: errorRpc(t, r.error, t("noSaldo")) };

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: t("saldoAplicado", {
      numero: r.numero ?? "",
      monto: pesos(r.aplicado ?? 0),
    }),
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
  const t = await getTranslations("pedidos.acciones");
  const parsed = CupoDiaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("datosNoValidos") };
  const { sedeId, fecha, cupo, cerrado } = parsed.data;
  const nota = parsed.data.nota?.trim() || null;

  const supabase = await createClient();
  const { data: sede } = await supabase
    .from("sedes")
    .select("id, workspace_id, nombre")
    .eq("id", sedeId)
    .maybeSingle();
  if (!sede) return { ok: false, error: t("sedeNoEncontrada") };

  const acceso = await checkWorkspaceMember(sede.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: t("sinPermisoCupos") };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sin ajuste: se borra la fila y queda el cupo normal de la sede.
  const { error } =
    cupo === null && !cerrado
      ? await supabase
          .from("cupos_dia")
          .delete()
          .eq("sede_id", sedeId)
          .eq("fecha", fecha)
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
    return { ok: false, error: t("noCupo") };
  }

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: cerrado
      ? t("cuposCerrados")
      : cupo === null
        ? t("cupoNormal")
        : t("cupoDia", { cupo }),
  };
}

// ── Valor del domicilio ──────────────────────────────────────────────────────

const DomicilioSchema = z.object({
  pedidoId: z.string().uuid(),
  valor: z.number().int().min(0).max(10_000_000),
});

/**
 * Fija (o corrige) el valor del domicilio de un pedido. Los pedidos sin
 * tarifa llegan con el domicilio por definir y no se puede confirmar su pago
 * hasta fijarlo. pd_fijar_domicilio revisa el rol (admin, manager, agent).
 */
export async function fijarDomicilio(input: {
  pedidoId: string;
  valor: number;
}): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  const t = await getTranslations("pedidos.acciones");
  const parsed = DomicilioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("datosNoValidos") };

  const supabase = await createClient();
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("workspace_id")
    .eq("id", parsed.data.pedidoId)
    .maybeSingle();
  if (!pedido) return { ok: false, error: t("rpc.PEDIDO_NO_ENCONTRADO") };

  const acceso = await checkWorkspaceMember(pedido.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: t("sinPermisoPedidos") };

  const { data, error } = await supabase.rpc("pd_fijar_domicilio", {
    p_pedido_id: parsed.data.pedidoId,
    p_valor: parsed.data.valor,
  });
  if (error) {
    console.error("[pedidos] fijar domicilio:", error.message);
    return { ok: false, error: t("noDomicilio") };
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; numero?: string };
  if (!r.ok) return { ok: false, error: errorRpc(t, r.error, t("noDomicilio")) };

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: t("domicilioFijado", {
      valor: pesos(parsed.data.valor),
      numero: r.numero ?? "",
    }),
  };
}

// ── Excedente de un pago ─────────────────────────────────────────────────────

const ExcedenteSchema = z.object({
  pagoId: z.string().uuid(),
  destino: z.enum(DESTINOS_EXCEDENTE),
});

/**
 * Decide qué hacer con lo que un cliente pagó de más: saldo a favor (para otro
 * pedido) o propina. Cualquiera del equipo (admin, manager, agent);
 * pd_decidir_excedente lo vuelve a revisar en la base de datos.
 */
export async function decidirExcedente(input: {
  pagoId: string;
  destino: DestinoExcedente;
}): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  const t = await getTranslations("pedidos.acciones");
  const parsed = ExcedenteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("datosNoValidos") };

  const supabase = await createClient();
  const { data: pago } = await supabase
    .from("pagos_pedido")
    .select("workspace_id")
    .eq("id", parsed.data.pagoId)
    .maybeSingle();
  if (!pago) return { ok: false, error: t("rpc.PAGO_NO_EXISTE") };
  const acceso = await checkWorkspaceMember(pago.workspace_id as string, {
    minRole: "agent",
  });
  if (!acceso.ok) return { ok: false, error: t("rpc.NO_AUTORIZADO") };

  const { data, error } = await supabase.rpc("pd_decidir_excedente", {
    p_pago_id: parsed.data.pagoId,
    p_destino: parsed.data.destino,
  });
  if (error) {
    console.error("[pedidos] decidirExcedente:", error.message);
    return { ok: false, error: t("noExcedente") };
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; excedente?: number };
  if (!r.ok) return { ok: false, error: errorRpc(t, r.error, t("noExcedente")) };

  revalidatePath("/pedidos");
  return {
    ok: true,
    mensaje: t(parsed.data.destino === "saldo_favor" ? "excedenteASaldo" : "excedenteAPropina", {
      excedente: pesos(r.excedente ?? 0),
    }),
  };
}
