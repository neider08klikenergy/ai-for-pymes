// Webhooks de Zernio: firma y lectura de eventos (módulo puro, sin base de
// datos, para poder probarlo con node --test).
//
// Firma: X-Zernio-Signature = HMAC-SHA256 (hex) del cuerpo crudo con el
// secreto que pusimos al crear el webhook en Zernio (ZERNIO_WEBHOOK_SECRET).
// Entrega "al menos una vez": se deduplica por el id del mensaje (wamid).

import { createHmac, timingSafeEqual } from "node:crypto";

export type ZernioChannel = "whatsapp" | "instagram" | "facebook";

const CHANNELS: readonly string[] = ["whatsapp", "instagram", "facebook"];

export function isZernioChannel(value: unknown): value is ZernioChannel {
  return typeof value === "string" && CHANNELS.includes(value);
}

export function verifyZernioSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature.trim().toLowerCase(), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Clave del contacto en `contacts.phone`. WhatsApp usa el número (el resto de
 * la app lo necesita); Instagram y Facebook no tienen teléfono, así que se
 * guarda el id del canal con prefijo.
 */
export function contactKeyFor(channel: ZernioChannel, participantId: string): string {
  if (channel === "whatsapp") return participantId.replace(/[^\d+]/g, "");
  return `${channel === "instagram" ? "ig" : "fb"}:${participantId}`;
}

/** true si `phone` es una clave de Instagram/Facebook y no un teléfono. */
export function isSocialContactKey(phone: string | null | undefined): boolean {
  return typeof phone === "string" && /^(ig|fb):/.test(phone);
}

const TYPE_MAP: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "document",
  document: "document",
  sticker: "sticker",
  location: "location",
};

export interface ZernioMedia {
  url: string;
  mime: string | null;
  filename: string | null;
  /** Posición del adjunto (para re-pedirlo a Zernio si la URL venció). */
  index: number;
}

export interface ZernioInbound {
  channel: ZernioChannel;
  /** Teléfono (WhatsApp) o clave ig:/fb: — va a contacts.phone. */
  from: string;
  /** Tipo de mensaje ya ajustado al enum de la base. */
  type: string;
  /** Tipo original de Zernio (attachment.type / originalType / "text"). */
  rawType: string;
  text: string | null;
  /** Id del mensaje en la plataforma (wamid en WhatsApp): clave de dedupe. */
  wamid: string;
  customerName: string | null;
  createTime: string;
  externalConversationId: string;
  externalAccountId: string;
  profileId: string | null;
  media: ZernioMedia | null;
}

function accountOf(event: Rec): { accountId: string | null; profileId: string | null; platform: string | null } {
  const account = rec(event.account);
  return {
    accountId: str(account?.accountId) ?? str(account?.id),
    profileId: str(account?.profileId),
    platform: str(account?.platform),
  };
}

function describeShare(originalType: string | null): string {
  if (originalType === "story_mention") return "[El cliente te mencionó en una historia]";
  if (originalType && /story/.test(originalType)) return "[El cliente respondió a una historia]";
  return "[El cliente compartió una publicación]";
}

/** `message.received` de un cliente (no los que envía el negocio). */
export function parseZernioInbound(body: unknown): ZernioInbound | null {
  const event = rec(body);
  if (!event || event.event !== "message.received") return null;
  const message = rec(event.message);
  if (!message || message.direction !== "incoming") return null;

  const channel = str(message.platform) ?? accountOf(event).platform;
  if (!isZernioChannel(channel)) return null;

  const conversation = rec(event.conversation);
  const sender = rec(message.sender);
  const { accountId, profileId } = accountOf(event);
  const externalConversationId = str(message.conversationId) ?? str(conversation?.id);
  const wamid = str(message.platformMessageId) ?? str(message.id);
  if (!accountId || !externalConversationId || !wamid) return null;

  const participant =
    channel === "whatsapp"
      ? (str(sender?.phoneNumber) ?? str(conversation?.participantId) ?? str(sender?.id))
      : (str(sender?.id) ?? str(conversation?.participantId));
  if (!participant) return null;

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const firstIndex = attachments.findIndex((a) => str(rec(a)?.url));
  const first = firstIndex >= 0 ? rec(attachments[firstIndex]) : null;
  const attType = str(first?.type);
  const originalType = str(first?.originalType);

  let type = "text";
  let text = str(message.text);
  let media: ZernioMedia | null = null;

  if (first && attType) {
    if (attType === "share") {
      text = text ?? describeShare(originalType);
    } else if (TYPE_MAP[attType]) {
      type = TYPE_MAP[attType];
      const payload = rec(first.payload);
      media = {
        url: str(first.url)!,
        mime: str(first.mimeType),
        filename: str(payload?.filename) ?? str(first.filename),
        index: firstIndex,
      };
      text = text ?? "[Multimedia]";
    } else {
      text = text ?? "[Multimedia]";
    }
  }

  return {
    channel,
    from: contactKeyFor(channel, participant),
    type,
    rawType: originalType ?? attType ?? "text",
    text,
    wamid,
    customerName:
      str(sender?.name) ?? str(conversation?.participantName) ?? str(sender?.username) ??
      str(conversation?.participantUsername),
    createTime: str(message.sentAt) ?? str(event.timestamp) ?? new Date().toISOString(),
    externalConversationId,
    externalAccountId: accountId,
    profileId,
    media,
  };
}

export interface ZernioEcho {
  channel: ZernioChannel;
  /** Contacto al que respondió el negocio (misma clave que contacts.phone). */
  to: string;
  wamid: string;
  type: string;
  text: string | null;
  createTime: string;
  externalConversationId: string;
  externalAccountId: string;
}

/**
 * `message.sent` que NO salió de nuestra API: una persona respondió desde la
 * bandeja de Zernio, desde la app de WhatsApp Business (coexistencia) o desde
 * la app de Instagram/Facebook. Esa conversación pasa a la persona.
 * Nuestros envíos llegan con sentVia "api" y se ignoran.
 */
export function parseZernioEcho(body: unknown): ZernioEcho | null {
  const event = rec(body);
  if (!event || event.event !== "message.sent") return null;
  const message = rec(event.message);
  if (!message) return null;

  const channel = str(message.platform) ?? accountOf(event).platform;
  if (!isZernioChannel(channel)) return null;

  const sentVia = message.sentVia ?? null;
  const source = str(message.source);
  const human =
    sentVia === "human" ||
    source === "whatsapp_business_app" ||
    (sentVia === null && channel !== "whatsapp");
  if (!human) return null;

  const conversation = rec(event.conversation);
  const { accountId } = accountOf(event);
  const participant = str(conversation?.participantId);
  const externalConversationId = str(message.conversationId) ?? str(conversation?.id);
  const wamid = str(message.platformMessageId) ?? str(message.id);
  if (!accountId || !participant || !externalConversationId || !wamid) return null;

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const attType = str(rec(attachments[0])?.type);
  const type = attType && TYPE_MAP[attType] ? TYPE_MAP[attType] : "text";

  return {
    channel,
    to: contactKeyFor(channel, participant),
    wamid,
    type,
    text: str(message.text) ?? (attType ? "[Multimedia]" : null),
    createTime: str(message.sentAt) ?? str(event.timestamp) ?? new Date().toISOString(),
    externalConversationId,
    externalAccountId: accountId,
  };
}

export interface ZernioStatus {
  wamid: string | null;
  providerMessageId: string | null;
  status: "delivered" | "read" | "failed";
  error: { code?: number; title?: string; message?: string; details?: string } | null;
}

const STATUS_EVENTS: Record<string, ZernioStatus["status"]> = {
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

export function parseZernioStatus(body: unknown): ZernioStatus | null {
  const event = rec(body);
  const status = event ? STATUS_EVENTS[String(event.event)] : undefined;
  if (!event || !status) return null;
  const message = rec(event.message);
  const wamid = str(message?.platformMessageId);
  const providerMessageId = str(message?.id);
  if (!wamid && !providerMessageId) return null;
  const err = rec(event.error);
  return {
    wamid,
    providerMessageId,
    status,
    error:
      status === "failed" && err
        ? {
            code: typeof err.code === "number" ? err.code : undefined,
            title: str(err.title) ?? undefined,
            message: str(err.message) ?? undefined,
            details: str(err.details) ?? undefined,
          }
        : null,
  };
}

export interface ZernioAccountEvent {
  kind: "connected" | "disconnected";
  accountId: string;
  profileId: string | null;
  platform: string | null;
  username: string | null;
  displayName: string | null;
}

export function parseZernioAccountEvent(body: unknown): ZernioAccountEvent | null {
  const event = rec(body);
  if (!event) return null;
  const kind =
    event.event === "account.connected"
      ? "connected"
      : event.event === "account.disconnected"
        ? "disconnected"
        : null;
  if (!kind) return null;
  const account = rec(event.account);
  const accountId = str(account?.accountId) ?? str(account?.id);
  if (!accountId) return null;
  return {
    kind,
    accountId,
    profileId: str(account?.profileId),
    platform: str(account?.platform),
    username: str(account?.username),
    displayName: str(account?.displayName),
  };
}

export interface ZernioTemplateStatus {
  accountId: string;
  profileId: string | null;
  name: string;
  language: string;
  status: string;
  reason: string | null;
}

export function parseZernioTemplateStatus(body: unknown): ZernioTemplateStatus | null {
  const event = rec(body);
  if (!event || event.event !== "whatsapp.template.status_updated") return null;
  const account = rec(event.account);
  const template = rec(event.template);
  const accountId = str(account?.accountId) ?? str(account?.id);
  const name = str(template?.name);
  const language = str(template?.language);
  const status = str(template?.status);
  if (!accountId || !name || !language || !status) return null;
  return {
    accountId,
    profileId: str(account?.profileId),
    name,
    language,
    status,
    reason: str(template?.reason),
  };
}

/** accountId del evento, sea cual sea (para enrutar al workspace). */
export function zernioEventAccountId(body: unknown): string | null {
  const event = rec(body);
  if (!event) return null;
  return accountOf(event).accountId;
}

export function zernioEventProfileId(body: unknown): string | null {
  const event = rec(body);
  if (!event) return null;
  return accountOf(event).profileId;
}
