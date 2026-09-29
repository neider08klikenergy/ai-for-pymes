// Envía al cliente, por su conversación de WhatsApp, el aviso que la persona
// aprobó en el panel. No cambia el estado de la conversación: la IA sigue
// atendiendo (a diferencia de escribir desde el inbox, que la duerme).
//
// Dentro de la ventana de 24 h va el texto libre. Fuera de ella, si el
// workspace tiene aprobada la plantilla del evento, va la plantilla; si no,
// queda una nota en el chat con el texto para que el equipo actúe.

import { dispatchTemplate, dispatchText } from "@/features/inbox/services/dispatch";
import { listTemplates } from "@/features/inbox/services/templates";

export type ResultadoAviso =
  | "enviado"
  | "enviado_plantilla"
  | "sin_aviso"
  | "sin_chat"
  | "ventana_cerrada"
  | "bloqueado"
  | "error";

export interface PlantillaAviso {
  nombre: string;
  parametros: string[];
  idioma?: string;
}

async function plantillaAprobada(workspaceId: string, nombre: string, idioma: string) {
  try {
    const aprobadas = await listTemplates(workspaceId, "approved");
    return aprobadas.some((t) => t.name === nombre && t.language === idioma);
  } catch (err) {
    console.error("[pedidos] no se pudieron leer las plantillas:", err);
    return false;
  }
}

export async function avisarCliente(opts: {
  workspaceId: string;
  conversationId: string | null;
  texto: string | null | undefined;
  userId: string;
  /** Plantilla para cuando la ventana de 24 h está cerrada. */
  plantilla?: PlantillaAviso | null;
}): Promise<ResultadoAviso> {
  const texto = opts.texto?.trim();
  if (!texto) return "sin_aviso";
  if (!opts.conversationId) return "sin_chat";

  const base = {
    workspaceId: opts.workspaceId,
    conversationId: opts.conversationId,
    body: texto.slice(0, 4096),
    senderUserId: opts.userId,
    meta: { origen: "panel_pedidos" },
  };

  try {
    // Sin nota todavía: si la ventana está cerrada se intenta la plantilla.
    const r = await dispatchText({ ...base, noteWhenBlocked: false });
    if (r.ok) return "enviado";
    if (r.errorCode === "OPT_OUT") return "bloqueado";
    if (r.errorCode !== "WINDOW_EXPIRED") {
      console.error("[pedidos] aviso al cliente falló:", r.errorCode, r.error);
      return "error";
    }

    const idioma = opts.plantilla?.idioma ?? "es";
    if (opts.plantilla && (await plantillaAprobada(opts.workspaceId, opts.plantilla.nombre, idioma))) {
      const t = await dispatchTemplate({
        workspaceId: opts.workspaceId,
        conversationId: opts.conversationId,
        templateName: opts.plantilla.nombre,
        templateLanguage: idioma,
        components: [
          {
            type: "body",
            parameters: opts.plantilla.parametros.map((text) => ({ type: "text" as const, text })),
          },
        ],
        senderUserId: opts.userId,
      });
      if (t.ok) return "enviado_plantilla";
      console.error("[pedidos] plantilla no enviada:", t.errorCode, t.error);
    }

    // Sin plantilla: el mismo envío deja ahora la nota en el chat (no sale nada).
    await dispatchText({ ...base, noteWhenBlocked: true });
    return "ventana_cerrada";
  } catch (err) {
    console.error("[pedidos] aviso al cliente falló:", err);
    return "error";
  }
}

export const TEXTO_AVISO: Record<ResultadoAviso, string | null> = {
  enviado: "Cliente avisado por WhatsApp",
  enviado_plantilla:
    "Cliente avisado con la plantilla aprobada (pasaron más de 24 h desde su último mensaje)",
  sin_aviso: null,
  sin_chat: "Este pedido no tiene chat de WhatsApp: avisa al cliente por otro medio",
  ventana_cerrada:
    "No se envió el WhatsApp: pasaron más de 24 h y la plantilla no está aprobada. Quedó una nota en el chat",
  bloqueado: "No se envió el WhatsApp: el cliente pidió no recibir mensajes",
  error: "No se pudo enviar el WhatsApp. Escríbele desde el chat",
};
