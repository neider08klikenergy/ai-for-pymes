// Crea un aviso para el equipo en el panel. Nunca lanza: un aviso fallido no
// debe romper el flujo que lo originó (traspaso, seguimiento…).

import { createClient as createSbClient } from "@supabase/supabase-js";

export type TipoNotificacion =
  | "handoff"
  | "cliente_esperando"
  | "ia_retomo"
  | "pedido_nuevo"
  | "pago_por_verificar";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function nombreDelContacto(conversationId: string): Promise<string> {
  try {
    const { data } = await svc()
      .from("conversations")
      .select("contacts(name, phone)")
      .eq("id", conversationId)
      .maybeSingle();
    const c = (data?.contacts ?? null) as { name?: string | null; phone?: string } | null;
    return c?.name?.trim() || c?.phone || "Un cliente";
  } catch {
    return "Un cliente";
  }
}

export async function crearNotificacion(n: {
  workspaceId: string;
  tipo: TipoNotificacion;
  titulo: string;
  cuerpo?: string | null;
  conversationId?: string | null;
  /** Si no se da y hay conversación, abre el chat. */
  enlace?: string | null;
}): Promise<void> {
  try {
    const { error } = await svc()
      .from("notificaciones")
      .insert({
        workspace_id: n.workspaceId,
        tipo: n.tipo,
        titulo: n.titulo.slice(0, 200),
        cuerpo: n.cuerpo?.slice(0, 500) ?? null,
        conversation_id: n.conversationId ?? null,
        enlace: n.enlace ?? (n.conversationId ? `/inbox/${n.conversationId}` : null),
      });
    if (error) console.warn("[notificaciones] no se pudo crear:", error.message);
  } catch (err) {
    console.warn("[notificaciones] no se pudo crear:", err);
  }
}

/** Aviso de traspaso a una persona, con el nombre del cliente. */
export async function notificarHandoff(opts: {
  workspaceId: string;
  conversationId: string;
  motivo: string;
}): Promise<void> {
  const nombre = await nombreDelContacto(opts.conversationId);
  await crearNotificacion({
    workspaceId: opts.workspaceId,
    tipo: "handoff",
    titulo: `${nombre} necesita una persona`,
    cuerpo: opts.motivo,
    conversationId: opts.conversationId,
  });
}

export { nombreDelContacto };
