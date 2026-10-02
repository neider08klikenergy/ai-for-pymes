// Una persona del equipo envía una imagen (con pie de foto opcional) desde el
// composer del inbox. Llega como multipart: `file` + `caption`.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { dispatchImage } from "@/features/inbox/services/dispatch";
import { applyTransition } from "@/features/inbox/services/decision-engine";
import { getActiveAgent } from "@/features/agents/services/active-agent";
import {
  removeStoredMedia,
  storeOutboundImage,
} from "@/features/inbox/services/media-handler";
import {
  OUTBOUND_CAPTION_MAX,
  isOutboundImageType,
  outboundImagePath,
  validateOutboundImage,
} from "@/features/inbox/lib/outbound-image";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId } = await params;
  if (!UUID.test(conversationId)) {
    return NextResponse.json({ error: "Conversación no válida" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envía la imagen como formulario" }, { status: 400 });
  }
  const file = form.get("file");
  const captionRaw = form.get("caption");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
  }
  const invalid = validateOutboundImage({ type: file.type, size: file.size });
  if (invalid || !isOutboundImageType(file.type)) {
    return NextResponse.json({ error: invalid ?? "Imagen no válida" }, { status: 400 });
  }
  const caption = typeof captionRaw === "string" ? captionRaw.trim() : "";
  if (caption.length > OUTBOUND_CAPTION_MAX) {
    return NextResponse.json(
      { error: `El texto de la imagen pasa de ${OUTBOUND_CAPTION_MAX} caracteres` },
      { status: 400 },
    );
  }

  // RLS prueba que el usuario ve la conversación; el rol se revisa aparte
  // porque dispatch corre con service role (igual que /messages).
  const { data: conv } = await supabase
    .from("conversations")
    .select("workspace_id, ai_enabled")
    .eq("id", conversationId)
    .single();
  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const workspaceId = conv.workspace_id as string;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "agent" });
  if (!auth.ok) return auth.response;

  const storagePath = await storeOutboundImage({
    storagePath: outboundImagePath(workspaceId, conversationId, file.type, randomUUID()),
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type,
  });
  if (!storagePath) {
    return NextResponse.json({ error: "No se pudo subir la imagen" }, { status: 502 });
  }

  const result = await dispatchImage({
    workspaceId,
    conversationId,
    storagePath,
    mimeType: file.type,
    sizeBytes: file.size,
    caption: caption || undefined,
    senderUserId: user.id,
  });

  if (!result.ok) {
    // Sin fila de mensaje (ventana, opt-out, error de base) la imagen no la
    // muestra nadie: se borra. Con fila fallida se conserva para el hilo.
    if (result.errorCode !== "SEND_FAILED") await removeStoredMedia(storagePath);
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Igual que un texto: si una persona escribe, la IA se duerme en este hilo.
  if (conv.ai_enabled) {
    try {
      const activeAgent = await getActiveAgent(workspaceId);
      if (activeAgent?.config.sleepOnManualMessage !== false) {
        await applyTransition(conversationId, "human_active", {
          userId: user.id,
          workspaceId,
        });
      }
    } catch (e) {
      console.warn(
        "[media] sleep-on-manual skipped:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return NextResponse.json({ ok: true, wamid: result.wamid });
}
