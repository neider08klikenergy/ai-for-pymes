// Envía al cliente, por su conversación de WhatsApp, el aviso que la persona
// aprobó en el panel. No cambia el estado de la conversación: la IA sigue
// atendiendo (a diferencia de escribir desde el inbox, que la duerme).

import { dispatchText } from "@/features/inbox/services/dispatch";

export type ResultadoAviso =
  | "enviado"
  | "sin_aviso"
  | "sin_chat"
  | "ventana_cerrada"
  | "bloqueado"
  | "error";

export async function avisarCliente(opts: {
  workspaceId: string;
  conversationId: string | null;
  texto: string | null | undefined;
  userId: string;
}): Promise<ResultadoAviso> {
  const texto = opts.texto?.trim();
  if (!texto) return "sin_aviso";
  if (!opts.conversationId) return "sin_chat";

  try {
    const r = await dispatchText({
      workspaceId: opts.workspaceId,
      conversationId: opts.conversationId,
      body: texto.slice(0, 4096),
      senderUserId: opts.userId,
      // Si no sale (ventana de 24 h, baja), deja una nota en el chat con el texto.
      noteWhenBlocked: true,
      meta: { origen: "panel_pedidos" },
    });
    if (r.ok) return "enviado";
    if (r.errorCode === "WINDOW_EXPIRED") return "ventana_cerrada";
    if (r.errorCode === "OPT_OUT") return "bloqueado";
    console.error("[pedidos] aviso al cliente falló:", r.errorCode, r.error);
    return "error";
  } catch (err) {
    console.error("[pedidos] aviso al cliente falló:", err);
    return "error";
  }
}

export const TEXTO_AVISO: Record<ResultadoAviso, string | null> = {
  enviado: "Cliente avisado por WhatsApp",
  sin_aviso: null,
  sin_chat: "Este pedido no tiene chat de WhatsApp: avisa al cliente por otro medio",
  ventana_cerrada:
    "No se envió el WhatsApp: pasaron más de 24 h desde el último mensaje del cliente. Quedó una nota en el chat",
  bloqueado: "No se envió el WhatsApp: el cliente pidió no recibir mensajes",
  error: "No se pudo enviar el WhatsApp. Escríbele desde el chat",
};
