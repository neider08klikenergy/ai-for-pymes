// Revisa cada minuto (desde el cron buffer-flush) las conversaciones que
// esperan a una persona. Ver las reglas en ../lib/seguimiento.ts.

import {
  MENSAJE_ESPERA,
  evaluarSeguimiento,
  leerConfigSeguimiento,
  repartirPorWorkspace,
  type MensajeSeguimiento,
} from "../lib/seguimiento";
import { crearNotificacion, nombreDelContacto } from "./crear";
import { dispatchText } from "@/features/inbox/services/dispatch";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { applyTransition } from "@/features/inbox/services/decision-engine";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// Se leen hasta MAX_CANDIDATAS (las más recientes: las que esperan respuesta
// acaban de recibir un mensaje del cliente) y se revisan como mucho
// MAX_CONVERSACIONES por pasada, por turnos entre workspaces y con
// MAX_POR_WORKSPACE cada uno. Antes eran las 30 más antiguas de todos los
// workspaces juntos: un workspace con muchas conversaciones atendidas por
// personas dejaba sin seguimiento a los demás.
const MAX_CANDIDATAS = 500;
const MAX_CONVERSACIONES = 60;
const MAX_POR_WORKSPACE = 10;
const MENSAJES_A_MIRAR = 30;

export interface ResultadoSeguimiento {
  revisadas: number;
  retomadas: number;
  recordadas: number;
}

export async function revisarSeguimiento(
  ahora = new Date(),
): Promise<ResultadoSeguimiento> {
  const supabase = svc();
  const res: ResultadoSeguimiento = {
    revisadas: 0,
    retomadas: 0,
    recordadas: 0,
  };

  // Candidatas: esperando a una persona y con actividad en las últimas 24 h.
  const { data: convs, error } = await supabase
    .from("conversations")
    .select(
      "id, workspace_id, state, window_expires_at, last_message_at, workspaces(settings)",
    )
    .in("state", ["human_active", "handoff_pending"])
    .gt(
      "last_message_at",
      new Date(ahora.getTime() - 24 * 3600_000).toISOString(),
    )
    .order("last_message_at", { ascending: false })
    .limit(MAX_CANDIDATAS);

  if (error) {
    console.error("[seguimiento] lectura de conversaciones:", error.message);
    return res;
  }

  type Candidata = {
    id: string;
    workspace_id: string;
    state: string;
    window_expires_at: string | null;
    workspaces: { settings: unknown } | { settings: unknown }[] | null;
  };
  // El seguimiento apagado se descarta ANTES de repartir los cupos.
  const activas = ((convs ?? []) as Candidata[])
    .map((c) => {
      const ws = Array.isArray(c.workspaces) ? c.workspaces[0] : c.workspaces;
      return { ...c, config: leerConfigSeguimiento(ws?.settings) };
    })
    .filter((c) => c.config.activo);

  for (const c of repartirPorWorkspace(activas, MAX_POR_WORKSPACE, MAX_CONVERSACIONES)) {
    const config = c.config;
    res.revisadas++;

    try {
      const accion = await evaluar(supabase, c, config.minutos, ahora);
      if (accion.tipo === "retomar_ia") {
        await retomarIa(
          supabase,
          c.id,
          c.workspace_id,
          accion.pendientes,
          config.minutos,
        );
        res.retomadas++;
      } else if (accion.tipo === "recordar_handoff") {
        await recordarHandoff(supabase, c.id, c.workspace_id, config.minutos);
        res.recordadas++;
      }
    } catch (err) {
      console.error(
        "[seguimiento] conversación",
        c.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return res;
}

async function evaluar(
  supabase: ReturnType<typeof svc>,
  c: {
    id: string;
    workspace_id: string;
    state: string;
    window_expires_at: string | null;
  },
  minutos: number,
  ahora: Date,
) {
  const { data: msgs } = await supabase
    .from("messages")
    .select("id, direction, type, created_at, sender_user_id, meta")
    .eq("workspace_id", c.workspace_id)
    .eq("conversation_id", c.id)
    .order("created_at", { ascending: false })
    .limit(MENSAJES_A_MIRAR);

  let handoffDesde: string | null = null;
  let yaRecordado = false;
  if (c.state === "handoff_pending") {
    const { data: ev } = await supabase
      .from("events")
      .select("created_at, payload")
      .eq("workspace_id", c.workspace_id)
      .eq("conversation_id", c.id)
      .eq("type", "state_change")
      .order("created_at", { ascending: false })
      .limit(5);
    const entrada = (
      (ev ?? []) as { created_at: string; payload: { to?: string } }[]
    ).find((e) => e.payload?.to === "handoff_pending");
    handoffDesde = entrada?.created_at ?? null;
    if (handoffDesde) {
      const { count } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", c.workspace_id)
        .eq("conversation_id", c.id)
        .eq("type", "seguimiento_recordatorio")
        .gte("created_at", handoffDesde);
      yaRecordado = (count ?? 0) > 0;
    }
  }

  return evaluarSeguimiento({
    estado: c.state,
    mensajes: (msgs ?? []) as MensajeSeguimiento[],
    handoffDesde,
    yaRecordado,
    ventanaAbierta:
      !c.window_expires_at || new Date(c.window_expires_at) > ahora,
    minutos,
    ahora,
  });
}

async function retomarIa(
  supabase: ReturnType<typeof svc>,
  conversationId: string,
  workspaceId: string,
  pendientes: string[],
  minutos: number,
) {
  await applyTransition(conversationId, "ai_active", {
    trigger: "sin_respuesta_humana",
    workspaceId,
  });

  // Lo pendiente va en UN solo lote, para que la IA conteste una vez y no
  // mensaje por mensaje. Se procesa en el siguiente minuto del cron.
  for (let i = 0; i < pendientes.length; i++) {
    const { error } = await supabase.rpc("upsert_batch_and_link_message", {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      p_message_id: pendientes[i],
      p_silence_ms: 0,
      p_force_new_batch: i === 0,
    });
    if (error)
      console.error(
        "[seguimiento] no se pudo encolar",
        pendientes[i],
        error.message,
      );
  }

  const nombre = await nombreDelContacto(conversationId);
  await crearNotificacion({
    workspaceId,
    tipo: "ia_retomo",
    titulo: `La IA retomó la conversación con ${nombre}`,
    cuerpo: `Nadie respondió en ${minutos} minutos. Si quieres seguir tú, toma la conversación de nuevo.`,
    conversationId,
  });
}

async function recordarHandoff(
  supabase: ReturnType<typeof svc>,
  conversationId: string,
  workspaceId: string,
  minutos: number,
) {
  // Primero la marca: si algo falla después, no se repite cada minuto.
  await supabase.from("events").insert({
    type: "seguimiento_recordatorio",
    level: "info",
    workspace_id: workspaceId,
    conversation_id: conversationId,
    payload: { minutos },
  });

  const envio = await dispatchText({
    workspaceId,
    conversationId,
    body: MENSAJE_ESPERA,
    noteWhenBlocked: true,
    meta: { origen: "seguimiento_humano" },
  });
  if (!envio.ok)
    console.warn(
      "[seguimiento] mensaje de espera no enviado:",
      envio.errorCode,
    );

  const nombre = await nombreDelContacto(conversationId);
  await crearNotificacion({
    workspaceId,
    tipo: "cliente_esperando",
    titulo: `${nombre} lleva ${minutos} min esperando`,
    cuerpo:
      "Nadie ha tomado la conversación. Se le envió un mensaje de espera.",
    conversationId,
  });
}
