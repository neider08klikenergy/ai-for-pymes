// Cliente de Zernio (https://docs.zernio.com): un solo API para WhatsApp,
// Instagram y Facebook Messenger.
//
// Modelo multi-cliente: AI for PYMES tiene UNA cuenta de Zernio (una API key,
// en la variable ZERNIO_API_KEY de Vercel). Cada workspace es un "perfil" de
// Zernio y sus canales son "cuentas" conectadas a ese perfil por OAuth. El
// cliente nunca comparte contraseñas ni necesita cuenta en Zernio.
//
// Zernio envía por conversación (conversationId + accountId), no por teléfono.

export const ZERNIO_PLATFORMS = ["whatsapp", "instagram", "facebook"] as const;
export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number];

export function isZernioPlatform(value: unknown): value is ZernioPlatform {
  return (ZERNIO_PLATFORMS as readonly unknown[]).includes(value);
}

export class ZernioError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** Código estable de Zernio (`code` del sobre de error), si viene. */
  readonly code: string | null;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ZernioError";
    this.status = status;
    this.body = body;
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    this.code = typeof rec?.code === "string" ? rec.code : null;
  }
}

/** Sin API key no hay nada que hacer: se nombra la variable que falta. */
export class ZernioConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZernioConfigError";
  }
}

export function zernioApiKey(): string {
  return process.env.ZERNIO_API_KEY?.trim() ?? "";
}

export function zernioWebhookSecret(): string {
  return process.env.ZERNIO_WEBHOOK_SECRET?.trim() ?? "";
}

function baseUrl(): string {
  return (process.env.ZERNIO_API_BASE_URL?.trim() || "https://zernio.com/api").replace(/\/$/, "");
}

const TIMEOUT_MS = 15_000;

function errorText(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
  }
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  return `Zernio respondió ${status}`;
}

/**
 * Llamada a Zernio. `path` empieza en /v1/… Lanza ZernioError con el cuerpo
 * completo en cualquier respuesta no 2xx (el código de Meta, si lo hay, va en
 * `platformError`).
 */
export async function zernioRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: { query?: Record<string, string | number | boolean | undefined | null>; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const apiKey = zernioApiKey();
  if (!apiKey) {
    throw new ZernioConfigError("Falta ZERNIO_API_KEY en las variables de entorno del servidor");
  }
  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey.slice(0, 255);

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new ZernioError(res.status, body, errorText(body, res.status));
  return body as T;
}

// ── Perfiles (uno por workspace) ─────────────────────────────────────────────

export async function createProfile(name: string, description?: string): Promise<string> {
  try {
    const res = await zernioRequest<{ profile?: { _id?: string } }>("POST", "/v1/profiles", {
      body: { name: name.slice(0, 100), ...(description ? { description } : {}) },
    });
    const id = res.profile?._id;
    if (!id) throw new ZernioError(500, res, "Zernio no devolvió el id del perfil");
    return id;
  } catch (err) {
    // Nombre repetido: Zernio devuelve el perfil existente en details.
    if (err instanceof ZernioError && err.status === 409) {
      const details = (err.body as { details?: { existingProfileId?: unknown } } | null)?.details;
      if (typeof details?.existingProfileId === "string") return details.existingProfileId;
    }
    throw err;
  }
}

// ── Conexión de cuentas (OAuth en la página de Meta) ─────────────────────────

export async function getConnectUrl(params: {
  platform: ZernioPlatform;
  profileId: string;
  redirectUrl: string;
  brandName?: string;
}): Promise<string> {
  const query: Record<string, string | undefined> = {
    profileId: params.profileId,
    redirect_url: params.redirectUrl,
  };
  if (params.platform === "whatsapp") {
    // Página de registro de WhatsApp alojada por Zernio, en español y con
    // nuestro nombre. `api`: número que ya usa la API de WhatsApp (o nuevo).
    query.signup = "hosted";
    query.language = "es";
    query.onboarding = "api";
    if (params.brandName) query.brandName = params.brandName.slice(0, 60);
  }
  const res = await zernioRequest<{ authUrl?: string }>(
    "GET",
    `/v1/connect/${params.platform}`,
    { query },
  );
  if (!res.authUrl) throw new ZernioError(500, res, "Zernio no devolvió la URL de conexión");
  return res.authUrl;
}

export interface ZernioAccount {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  isActive: boolean;
}

export async function listAccounts(profileId: string): Promise<ZernioAccount[]> {
  const res = await zernioRequest<{ accounts?: Array<Record<string, unknown>> }>("GET", "/v1/accounts", {
    query: { profileId },
  });
  return (res.accounts ?? [])
    .map((a) => ({
      id: typeof a._id === "string" ? a._id : "",
      platform: typeof a.platform === "string" ? a.platform : "",
      username: typeof a.username === "string" ? a.username : null,
      displayName: typeof a.displayName === "string" ? a.displayName : null,
      isActive: a.isActive !== false,
    }))
    .filter((a) => a.id && isZernioPlatform(a.platform));
}

export async function disconnectAccount(accountId: string): Promise<void> {
  try {
    await zernioRequest("DELETE", `/v1/accounts/${encodeURIComponent(accountId)}`);
  } catch (err) {
    // Ya estaba desconectada: el resultado es el mismo.
    if (err instanceof ZernioError && err.status === 404) return;
    throw err;
  }
}

// ── Mensajes ─────────────────────────────────────────────────────────────────

interface SendResponse {
  success?: boolean;
  data?: {
    messageId?: string;
    conversationId?: string;
    partialFailure?: { error?: string; platformError?: Record<string, unknown> } | null;
  };
}

function sentMessageId(res: SendResponse): { messageId: string | null; conversationId: string | null } {
  const partial = res.data?.partialFailure;
  if (partial && !res.data?.messageId) {
    throw new ZernioError(502, { error: partial.error, platformError: partial.platformError }, partial.error ?? "Envío fallido");
  }
  return {
    messageId: res.data?.messageId ?? null,
    conversationId: res.data?.conversationId ?? null,
  };
}

/** Responde en una conversación existente (WhatsApp, Instagram o Facebook). */
export async function sendMessage(params: {
  conversationId: string;
  accountId: string;
  text?: string;
  template?: { name: string; language: string; components?: unknown[] };
  idempotencyKey?: string;
}) {
  const body: Record<string, unknown> = { accountId: params.accountId };
  if (params.text !== undefined) body.message = params.text;
  if (params.template) body.template = { elements: [params.template] };
  const res = await zernioRequest<SendResponse>(
    "POST",
    `/v1/inbox/conversations/${encodeURIComponent(params.conversationId)}/messages`,
    { body, idempotencyKey: params.idempotencyKey },
  );
  return sentMessageId(res);
}

/**
 * WhatsApp: escribe a un número sin conversación previa en Zernio (texto dentro
 * de la ventana de 24 h, o plantilla aprobada fuera de ella).
 */
export async function startWhatsAppConversation(params: {
  accountId: string;
  phone: string;
  text?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  idempotencyKey?: string;
}) {
  const body: Record<string, unknown> = {
    accountId: params.accountId,
    participantId: params.phone.replace(/\D/g, ""),
  };
  if (params.text !== undefined) body.message = params.text;
  if (params.templateName) {
    body.templateName = params.templateName;
    body.templateLanguage = params.templateLanguage ?? "es";
    if (params.templateParams?.length) body.templateParams = params.templateParams;
  }
  const res = await zernioRequest<SendResponse>("POST", "/v1/inbox/conversations", {
    body,
    idempotencyKey: params.idempotencyKey,
  });
  return sentMessageId(res);
}

// ── Plantillas de WhatsApp ───────────────────────────────────────────────────

export async function listWhatsAppTemplates(accountId: string): Promise<unknown[]> {
  const res = await zernioRequest<{ templates?: unknown[] }>("GET", "/v1/whatsapp/templates", {
    query: { accountId },
  });
  return res.templates ?? [];
}

export async function createWhatsAppTemplate(
  accountId: string,
  payload: { name: string; language: string; category: string; components: unknown },
): Promise<{ id: string }> {
  const res = await zernioRequest<Record<string, unknown>>("POST", "/v1/whatsapp/templates", {
    body: { accountId, ...payload },
  });
  const tpl = (res.template ?? res.data ?? res) as Record<string, unknown>;
  const id = typeof tpl.id === "string" ? tpl.id : typeof tpl.templateId === "string" ? tpl.templateId : "";
  return { id };
}
