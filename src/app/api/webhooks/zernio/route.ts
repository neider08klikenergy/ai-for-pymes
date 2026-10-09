import {
  parseZernioEcho,
  isZernioChannel,
  parseZernioStatus,
  parseZernioInbound,
  zernioEventAccountId,
  zernioEventProfileId,
  verifyZernioSignature,
  parseZernioAccountEvent,
  parseZernioTemplateStatus,
} from "@/features/inbox/services/zernio-webhook-handler";
import {
  applyAccountEvent,
  findZernioWorkspace,
} from "@/features/inbox/services/zernio-accounts";
import {
  processInbound,
  processOutboundEcho,
} from "@/features/inbox/services/normalizer";
import {
  upsertBatch,
  hasTimeToClaim,
  processNextBatch,
} from "@/features/inbox/services/buffer";
import {
  patchMessageMedia,
  downloadAndStoreMedia,
} from "@/features/inbox/services/media-handler";
import {
  describeImage,
  transcribeAudio,
} from "@/features/inbox/services/media-understanding";
import { type NextRequest, NextResponse, after } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { mapTemplateStatus } from "@/features/inbox/services/templates";
import { checkRateLimits } from "@/features/inbox/services/cost-tracker";
import { zernioWebhookSecret } from "@/features/inbox/services/zernio-client";
import { applyMessageStatus } from "@/features/inbox/services/message-status";
import { parseWhatsAppError } from "@/features/inbox/services/whatsapp-errors";

// Webhook único de Zernio para todos los workspaces: una sola cuenta de Zernio
// (la de AI for PYMES), con un perfil por workspace. Cada evento trae la cuenta
// conectada (account.accountId) y su perfil, y con eso se busca el workspace.
//
// Mismo presupuesto de tiempo que el webhook de Kapso (ver ese archivo).
export const maxDuration = 300;

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    const rawBody = await request.text();

    // Firma antes que cualquier otra cosa.
    const secret = zernioWebhookSecret();
    const signature =
      request.headers.get("x-zernio-signature") ??
      request.headers.get("x-late-signature");
    if (!secret || !verifyZernioSignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const supabase = svc();
    const ws = await findZernioWorkspace(
      supabase,
      zernioEventAccountId(body),
      zernioEventProfileId(body),
    );
    // Cuenta que no es de ningún workspace (p. ej. el sandbox de Zernio): 200
    // para que Zernio no reintente.
    if (!ws) return NextResponse.json({ received: true, routed: false });
    const workspaceId = ws.workspaceId;

    // ── Cuentas conectadas / desconectadas ────────────────────────────────
    const accountEvent = parseZernioAccountEvent(body);
    if (accountEvent) {
      if (
        accountEvent.kind === "disconnected" ||
        isZernioChannel(accountEvent.platform)
      ) {
        await applyAccountEvent(supabase, workspaceId, ws.config, accountEvent);
      }
      return NextResponse.json({ received: true, account: accountEvent.kind });
    }

    // ── Estado de plantillas de WhatsApp ──────────────────────────────────
    const templateStatus = parseZernioTemplateStatus(body);
    if (templateStatus) {
      const status = mapTemplateStatus(templateStatus.status);
      const now = new Date().toISOString();
      await supabase
        .from("templates")
        .update({
          status,
          rejection_reason:
            status === "rejected" ? templateStatus.reason : null,
          ...(status === "approved" ? { approved_at: now } : {}),
          updated_at: now,
        })
        .eq("workspace_id", workspaceId)
        .eq("name", templateStatus.name)
        .eq("language", templateStatus.language);
      return NextResponse.json({ received: true, template: status });
    }

    // Lo demás solo aplica cuando Zernio es el proveedor activo del workspace.
    if (!ws.enabled) {
      return NextResponse.json({ received: true, active: false });
    }

    // ── Estados de mensajes enviados ──────────────────────────────────────
    const statusData = parseZernioStatus(body);
    if (statusData) {
      await applyMessageStatus(supabase, workspaceId, {
        wamid: statusData.wamid,
        providerMessageId: statusData.providerMessageId,
        status: statusData.status,
        error: statusData.error ? parseWhatsAppError(statusData.error) : null,
      });
      return NextResponse.json({ received: true });
    }

    // ── Una persona respondió fuera de nuestra app ────────────────────────
    const echo = parseZernioEcho(body);
    if (echo) {
      const result = await processOutboundEcho(workspaceId, {
        to: echo.to,
        wamid: echo.wamid,
        type: echo.type,
        text: echo.text,
        createTime: echo.createTime,
        phoneNumberId: null,
        channel: echo.channel,
        origin: "zernio",
      });
      return NextResponse.json({
        received: true,
        echo: true,
        recorded: result.inserted,
        aiDisabled: result.aiDisabled,
      });
    }

    // ── Mensaje de un cliente ─────────────────────────────────────────────
    const normalized = parseZernioInbound(body);
    if (!normalized) {
      return NextResponse.json({ received: true });
    }

    const { contact, conversation, message } = await processInbound(
      workspaceId,
      {
        from: normalized.from,
        type: normalized.type,
        rawType: normalized.rawType,
        text: normalized.text,
        wamid: normalized.wamid,
        customerName: normalized.customerName,
        channel: normalized.channel,
        externalConversationId: normalized.externalConversationId,
        externalAccountId: normalized.externalAccountId,
      },
    );

    // Reintento de Zernio (entrega al menos una vez): ya procesado.
    if (!message) {
      return NextResponse.json({ received: true, dedup: true });
    }

    // Medios: se descargan YA (el enlace de Meta vence y WhatsApp borra el
    // archivo a los pocos días) y se describen para que el agente los entienda.
    const media = normalized.media;
    const messageId = message.id;
    const conversationId = conversation.id;
    const mediaJob = media
      ? async () => {
          try {
            const mediaMeta = await downloadAndStoreMedia({
              provider: "zernio",
              link: media.url,
              workspaceId,
              conversationId,
              mimeType: media.mime ?? undefined,
              filename: media.filename ?? undefined,
              caption:
                normalized.text && normalized.text !== "[Multimedia]"
                  ? normalized.text
                  : undefined,
            });
            if (!mediaMeta) return;

            if (normalized.type === "audio") {
              const transcript = await transcribeAudio({
                storagePath: mediaMeta.storage_path,
                mimeType: mediaMeta.mime_type,
                workspaceId,
                contactId: contact.id,
              });
              if (transcript) mediaMeta.transcript = transcript;
            } else if (normalized.type === "image") {
              const description = await describeImage({
                storagePath: mediaMeta.storage_path,
                mimeType: mediaMeta.mime_type,
                caption: mediaMeta.caption,
                workspaceId,
                contactId: contact.id,
              });
              if (description) mediaMeta.description = description;
            }

            await patchMessageMedia(workspaceId, messageId, mediaMeta);
          } catch (mediaErr) {
            console.error(
              "[zernio webhook] media handling failed:",
              mediaErr instanceof Error ? mediaErr.message : "unknown",
            );
          }
        }
      : null;

    // IA apagada: igual se guarda el archivo para que la persona lo vea.
    if (!conversation.ai_enabled) {
      if (mediaJob) after(mediaJob);
      return NextResponse.json({ received: true, ai: false });
    }

    const { allowed, reason } = await checkRateLimits(workspaceId, contact.id);
    if (!allowed) {
      console.warn(
        "[zernio webhook] rate limited:",
        reason ?? "unknown reason",
      );
      if (mediaJob) after(mediaJob);
      return NextResponse.json({ received: true, rateLimited: true });
    }

    const bufferSeconds = Number(
      (ws.config as { buffer_silence_seconds?: number }).buffer_silence_seconds,
    );
    const silenceMs =
      Number.isFinite(bufferSeconds) && bufferSeconds >= 3
        ? Math.min(bufferSeconds, 120) * 1000
        : undefined;

    await upsertBatch({
      workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      silenceMs,
    });

    // Camino rápido, igual que en Kapso: el cron de cada minuto es el respaldo.
    const effectiveSilenceMs = silenceMs ?? 30_000;
    after(async () => {
      if (mediaJob) await mediaJob();
      await new Promise((resolve) =>
        setTimeout(resolve, effectiveSilenceMs + 500),
      );
      if (!hasTimeToClaim(startedAt, maxDuration)) return;
      try {
        await processNextBatch();
      } catch (e) {
        console.error(
          "[zernio webhook] fast-path process error:",
          e instanceof Error ? e.message : "unknown",
        );
      }
    });

    return NextResponse.json({ received: true, buffered: true });
  } catch (err) {
    // SEC-09: nunca el objeto completo (puede traer datos del cliente).
    console.error(
      "[zernio webhook] unhandled error:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
