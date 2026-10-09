// Seguimiento de conversaciones que esperan a una persona.
//
// Reglas (aprobadas 29 sep 2026):
//  - human_active: el equipo tomó la conversación. Si el cliente escribe y
//    nadie le responde en N minutos (8 por defecto), la IA la retoma y contesta
//    lo pendiente.
//  - handoff_pending: la IA la pasó a una persona (quejas, alergias,
//    reembolsos, o el cliente pidió una persona). NO se devuelve a la IA: a los
//    N minutos sin respuesta se le escribe al cliente un mensaje de espera y se
//    avisa otra vez al equipo (una sola vez por traspaso).
//
// Funciones puras: sin base de datos, para poder probarlas.

export const MINUTOS_POR_DEFECTO = 8;

export interface MensajeSeguimiento {
  id: string;
  direction: "in" | "out";
  type: string;
  created_at: string;
  sender_user_id: string | null;
  meta: Record<string, unknown> | null;
}

export type AccionSeguimiento =
  | { tipo: "nada" }
  | { tipo: "retomar_ia"; pendientes: string[]; esperandoDesde: string }
  | { tipo: "recordar_handoff"; esperandoDesde: string };

export interface ConfigSeguimiento {
  activo: boolean;
  minutos: number;
}

/** workspaces.settings.seguimiento_humano = { activo, minutos } */
export function leerConfigSeguimiento(settings: unknown): ConfigSeguimiento {
  const s = (settings as { seguimiento_humano?: { activo?: unknown; minutos?: unknown } } | null)
    ?.seguimiento_humano;
  const minutos = Number(s?.minutos);
  return {
    activo: s?.activo !== false,
    minutos: Number.isFinite(minutos) && minutos >= 1 && minutos <= 240 ? minutos : MINUTOS_POR_DEFECTO,
  };
}

function esNotaOSistema(m: MensajeSeguimiento): boolean {
  return m.type === "system" || m.meta?.internal === true;
}

function esEntrante(m: MensajeSeguimiento): boolean {
  return m.direction === "in" && !esNotaOSistema(m) && m.meta?.no_reply !== true;
}

/** Respuesta de una persona: desde el panel o desde el celular (coexistencia). */
export function esRespuestaHumana(m: MensajeSeguimiento): boolean {
  return (
    m.direction === "out" &&
    !esNotaOSistema(m) &&
    (!!m.sender_user_id || m.meta?.origin === "business_app")
  );
}

function esSalienteReal(m: MensajeSeguimiento): boolean {
  return m.direction === "out" && !esNotaOSistema(m);
}

export function evaluarSeguimiento(input: {
  estado: string;
  /** Mensajes de la conversación, en cualquier orden. */
  mensajes: MensajeSeguimiento[];
  /** Cuándo entró a handoff_pending (último cambio de estado). */
  handoffDesde: string | null;
  /** Ya se envió el recordatorio para este traspaso. */
  yaRecordado: boolean;
  ventanaAbierta: boolean;
  minutos: number;
  ahora: Date;
}): AccionSeguimiento {
  const limiteMs = input.minutos * 60_000;
  const msgs = [...input.mensajes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const vencido = (iso: string) => input.ahora.getTime() - Date.parse(iso) >= limiteMs;

  if (input.estado === "human_active") {
    if (!input.ventanaAbierta) return { tipo: "nada" };
    // Lo que el cliente escribió después de la última respuesta (de quien sea).
    let ultimaSalida = -1;
    msgs.forEach((m, i) => {
      if (esSalienteReal(m)) ultimaSalida = i;
    });
    const pendientes = msgs.slice(ultimaSalida + 1).filter(esEntrante);
    if (pendientes.length === 0) return { tipo: "nada" };
    const desde = pendientes[0].created_at;
    if (!vencido(desde)) return { tipo: "nada" };
    return { tipo: "retomar_ia", pendientes: pendientes.map((m) => m.id), esperandoDesde: desde };
  }

  if (input.estado === "handoff_pending") {
    if (input.yaRecordado || !input.ventanaAbierta) return { tipo: "nada" };
    const desde =
      input.handoffDesde ?? msgs.filter(esEntrante).at(-1)?.created_at ?? null;
    if (!desde || !vencido(desde)) return { tipo: "nada" };
    const respondio = msgs.some((m) => esRespuestaHumana(m) && m.created_at >= desde);
    if (respondio) return { tipo: "nada" };
    return { tipo: "recordar_handoff", esperandoDesde: desde };
  }

  return { tipo: "nada" };
}

export const MENSAJE_ESPERA =
  "Gracias por tu paciencia 🙏 Una persona de nuestro equipo te atiende en breve.";

const MOTIVO_HANDOFF: Record<string, string> = {
  keyword: "El cliente pidió hablar con una persona",
  agent: "La IA pasó la conversación a una persona",
  pasar_a_persona: "La IA pidió ayuda de una persona",
  manual: "Se pasó la conversación a una persona",
  cost_cut: "Se alcanzó el límite de gasto de IA",
  write_tool_unfinished: "La IA hizo una acción pero no pudo terminar su respuesta",
  empty_reply: "La IA hizo una acción pero no pudo terminar su respuesta",
  batch_dead_letter: "La IA no pudo responder después de varios intentos",
};

export function motivoHandoff(trigger: string | undefined): string {
  return MOTIVO_HANDOFF[trigger ?? ""] ?? "La conversación necesita una persona";
}

/**
 * Elige qué conversaciones revisar en esta pasada, por turnos entre
 * workspaces: como mucho `porWorkspace` de cada uno y `total` en la pasada,
 * respetando el orden de entrada dentro de cada workspace. Así un workspace
 * con muchas conversaciones esperando no deja sin seguimiento a los demás.
 */
export function repartirPorWorkspace<T extends { workspace_id: string }>(
  candidatas: T[],
  porWorkspace: number,
  total: number,
): T[] {
  const colas = new Map<string, T[]>();
  for (const c of candidatas) {
    const cola = colas.get(c.workspace_id) ?? [];
    if (cola.length < porWorkspace) cola.push(c);
    colas.set(c.workspace_id, cola);
  }
  const elegidas: T[] = [];
  for (let ronda = 0; ronda < porWorkspace && elegidas.length < total; ronda++) {
    for (const cola of colas.values()) {
      if (ronda < cola.length) elegidas.push(cola[ronda]);
      if (elegidas.length >= total) break;
    }
  }
  return elegidas;
}
