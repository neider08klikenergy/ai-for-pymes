import { generateText } from "ai";
import { APP_NAME } from "@/lib/branding";
import { createOpenAI } from "@ai-sdk/openai";
import { getOpenRouterApiKey } from "./openrouter";
import { enforceCostPolicy } from "./cost-enforcer";
import { createClient as svcClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Media understanding — turns inbound voice notes and images into text via a
// cheap multimodal model (OpenRouter → Gemini Flash) so the agent can "read"
// them. The result is stored in messages.meta (transcript / description) and
// the buffer consolidation injects it as text — the agent keeps its own model.
// ──────────────────────────────────────────────────────────────────────────────

const BUCKET = "whatsapp-media";

/** Multimodal model used only for media→text. Overridable via env. */
const UNDERSTANDING_MODEL =
  process.env.MEDIA_UNDERSTANDING_MODEL ?? "google/gemini-2.5-flash";

// Presupuesto: cada transcripción o descripción reserva un cupo (por contacto y
// por workspace, por hora), respeta el corte diario y registra sus tokens en
// el presupuesto. Sin cupo, sin presupuesto o con un archivo demasiado grande
// no se llama al modelo: el mensaje queda como "[nota de voz]" / "[imagen]" y
// el equipo igual ve el archivo en el inbox.
export const MEDIA_LIMITE_CONTACTO_HORA = 20;
export const MEDIA_LIMITE_WORKSPACE_HORA = 300;
/** WhatsApp admite audios de hasta 16 MB e imágenes de hasta 5 MB. */
export const MEDIA_MAX_BYTES = {
  audio: 16 * 1024 * 1024,
  imagen: 8 * 1024 * 1024,
};

function svc() {
  return svcClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function downloadBytes(storagePath: string): Promise<Uint8Array | null> {
  const { data, error } = await svc()
    .storage.from(BUCKET)
    .download(storagePath);
  if (error || !data) {
    console.error(
      "[media-understanding] storage download failed:",
      error?.message ?? "no data",
    );
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Reserva una llamada de media para este contacto. null = no llamar al modelo
 * (presupuesto cortado, límite alcanzado o error: falla cerrado, porque la
 * transcripción es opcional y la paga la plataforma).
 */
async function reservarMedia(
  workspaceId: string,
  contactId: string,
): Promise<string | null> {
  try {
    const budget = await enforceCostPolicy(workspaceId);
    if (budget.policy === "cut") return null;
    const { data, error } = await svc().rpc("reserve_media_understanding", {
      p_workspace_id: workspaceId,
      p_contact_id: contactId,
      p_contact_limit: MEDIA_LIMITE_CONTACTO_HORA,
      p_workspace_limit: MEDIA_LIMITE_WORKSPACE_HORA,
    });
    if (error) {
      console.error("[media-understanding] reserva:", error.message);
      return null;
    }
    const fila = (Array.isArray(data) ? data[0] : data) as {
      allowed?: boolean;
      reservation_id?: string | null;
    } | null;
    return fila?.allowed && fila.reservation_id ? fila.reservation_id : null;
  } catch (err) {
    console.error(
      "[media-understanding] presupuesto:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}

/** Escribe los tokens reales en la fila reservada (cuentan en el presupuesto diario). */
async function registrarUso(
  reservationId: string,
  workspaceId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  const { data: fila } = await svc()
    .from("events")
    .select("payload")
    .eq("id", reservationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const { error } = await svc()
    .from("events")
    .update({
      payload: {
        ...((fila?.payload as Record<string, unknown> | null) ?? {}),
        reserved: false,
        model: UNDERSTANDING_MODEL,
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    })
    .eq("id", reservationId)
    .eq("workspace_id", workspaceId)
    .eq("type", "media_understanding");
  if (error)
    console.error("[media-understanding] registro de uso:", error.message);
}

function openrouter(apiKey: string) {
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": APP_NAME,
    },
  });
}

/**
 * Transcribes a WhatsApp voice note. Returns the verbatim text, or null on any
 * failure (caller degrades gracefully — the agent still sees "[nota de voz]").
 */
export async function transcribeAudio(opts: {
  storagePath: string;
  mimeType?: string;
  workspaceId: string;
  /** Quien lo envió: el límite por hora es por contacto. */
  contactId: string;
}): Promise<string | null> {
  const bytes = await downloadBytes(opts.storagePath);
  if (!bytes || bytes.length > MEDIA_MAX_BYTES.audio) return null;

  const apiKey = await getOpenRouterApiKey(opts.workspaceId);
  if (!apiKey) return null;
  const reserva = await reservarMedia(opts.workspaceId, opts.contactId);
  if (!reserva) return null;

  // Call OpenRouter directly with the OpenAI-style `input_audio` content part.
  // The AI SDK's `type:"file"` audio part is NOT serialized to `input_audio`,
  // so the model never received the audio and returned empty → the agent saw
  // "[nota de voz no transcrita]". WhatsApp voice notes are ogg/opus.
  const mime = opts.mimeType || "audio/ogg";
  const format =
    mime.includes("mp3") || mime.includes("mpeg")
      ? "mp3"
      : mime.includes("wav")
        ? "wav"
        : mime.includes("m4a") || mime.includes("mp4")
          ? "m4a"
          : "ogg";
  const b64 = Buffer.from(bytes).toString("base64");

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": APP_NAME,
      },
      body: JSON.stringify({
        model: UNDERSTANDING_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe esta nota de voz de WhatsApp palabra por palabra, en su idioma original. Devuelve SOLO la transcripción, sin comentarios ni comillas.",
              },
              { type: "input_audio", input_audio: { data: b64, format } },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      console.error(
        "[media-understanding] transcribeAudio HTTP",
        res.status,
        (await res.text()).slice(0, 200),
      );
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    await registrarUso(
      reserva,
      opts.workspaceId,
      data?.usage?.prompt_tokens ?? 0,
      data?.usage?.completion_tokens ?? 0,
    );
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch (err) {
    console.error(
      "[media-understanding] transcribeAudio error:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}

/**
 * Describes an inbound image so the agent understands what the client sent
 * (documents, screenshots, photos of teeth, etc.). Returns null on failure.
 */
export async function describeImage(opts: {
  storagePath: string;
  mimeType?: string;
  caption?: string;
  workspaceId: string;
  /** Quien la envió: el límite por hora es por contacto. */
  contactId: string;
}): Promise<string | null> {
  const bytes = await downloadBytes(opts.storagePath);
  if (!bytes || bytes.length > MEDIA_MAX_BYTES.imagen) return null;

  const apiKey = await getOpenRouterApiKey(opts.workspaceId);
  if (!apiKey) return null;
  const reserva = await reservarMedia(opts.workspaceId, opts.contactId);
  if (!reserva) return null;

  try {
    const { text, usage } = await generateText({
      model: openrouter(apiKey).chat(UNDERSTANDING_MODEL),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Un cliente envió esta imagen por WhatsApp${
                opts.caption ? ` con el texto: "${opts.caption}"` : ""
              }. Describe de forma concisa y útil qué muestra (objetos, personas, texto o documentos visibles, lo relevante para atención al cliente). Máximo 2–3 frases, en español.`,
            },
            { type: "image", image: bytes, mediaType: opts.mimeType },
          ],
        },
      ],
      maxOutputTokens: 512,
    });
    await registrarUso(
      reserva,
      opts.workspaceId,
      usage?.inputTokens ?? 0,
      usage?.outputTokens ?? 0,
    );
    return text.trim() || null;
  } catch (err) {
    console.error(
      "[media-understanding] describeImage error:",
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}
