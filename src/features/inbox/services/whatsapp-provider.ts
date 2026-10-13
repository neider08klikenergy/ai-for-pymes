// WhatsApp providers. Each workspace picks ONE in Settings → Integraciones:
// Zernio or Kapso. Its
// `integrations` row is the enabled one with provider in WHATSAPP_PROVIDERS —
// a partial unique index guarantees there is at most one per workspace.
//
// Everything that is not about talking to the provider (dispatch, the buffer,
// handoff, Jev, templates) goes through this module instead of naming a
// provider, so both keep working side by side on `main`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredentials } from "@/shared/lib/integration-secrets";
import { zernioApiKey, zernioWebhookSecret } from "./zernio-client";

export const WHATSAPP_PROVIDERS = ["kapso", "zernio"] as const;
export type WhatsAppProvider = (typeof WHATSAPP_PROVIDERS)[number];

export const WHATSAPP_PROVIDER_LABELS: Record<WhatsAppProvider, string> = {
  kapso: "Kapso",
  zernio: "Zernio",
};

/** Thrown (inside the message) when a workspace has no active WhatsApp provider. */
export const WHATSAPP_NOT_CONNECTED = "WhatsApp integration not found";

export function isWhatsAppProvider(value: unknown): value is WhatsAppProvider {
  return (WHATSAPP_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * Keys of the WhatsApp integration `config` that belong to the WORKSPACE, not
 * to the provider: they survive a provider switch (carried over to the new
 * row). Everything else in the config — phone number, Meta ids — is the
 * provider's own and stays with its row.
 */
export const WORKSPACE_WHATSAPP_SETTINGS = [
  "buffer_silence_seconds",
  "message_history_window",
  "handoff_ack_enabled",
  "handoff_ack_message",
  "cost_cut_handoff",
  "jev_enabled",
  "jev_stage",
  "jev_reply",
  "jev_opt_out",
] as const;

/** Where each provider keeps the id it sends from. */
const SENDER_ID_KEY: Record<WhatsAppProvider, string> = {
  kapso: "phone_number_id", // Meta's phone number id
  zernio: "profile_id", // the workspace's Zernio profile
};

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * What a provider still lacks before it can be a workspace's active one: the
 * API key, the webhook signing secret and the id it sends from. Without any of
 * them nothing goes out (or nothing comes in), so activating it would leave
 * the workspace silent. Returns user-facing labels; empty means ready.
 * `credentials` may be encrypted — only presence is checked.
 */
export function missingWhatsAppFields(
  provider: WhatsAppProvider,
  credentials: Record<string, unknown>,
  config: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  if (provider === "zernio") {
    // Zernio: una cuenta para toda la plataforma (variables de entorno) y los
    // canales conectados por OAuth en el perfil del workspace.
    if (!present(zernioApiKey())) missing.push("la variable ZERNIO_API_KEY en Vercel");
    if (!present(zernioWebhookSecret())) missing.push("la variable ZERNIO_WEBHOOK_SECRET en Vercel");
    const accounts = Array.isArray(config.account_ids) ? config.account_ids : [];
    if (!present(config.profile_id) || accounts.length === 0) {
      missing.push("conectar al menos un canal (WhatsApp, Instagram o Facebook)");
    }
    return missing;
  }
  if (!present(whatsappApiKey(provider, credentials))) missing.push("la API Key");
  if (!present(credentials.webhook_signing_secret)) {
    missing.push("el Webhook Signing Secret");
  }
  if (!present(config[SENDER_ID_KEY[provider]])) {
    missing.push(provider === "kapso" ? "el Phone Number ID" : "el número de WhatsApp");
  }
  return missing;
}

export interface WhatsAppSettingsRow {
  id: string;
  provider: WhatsAppProvider;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface WhatsAppIntegrationRow extends WhatsAppSettingsRow {
  credentials: Record<string, unknown> | null;
}

async function loadActiveRow(
  supabase: SupabaseClient,
  workspaceId: string,
  columns: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("integrations")
    .select(columns)
    .eq("workspace_id", workspaceId)
    .in("provider", WHATSAPP_PROVIDERS as unknown as string[])
    .eq("enabled", true)
    .maybeSingle();
  if (error) {
    throw new Error(`[whatsapp] integration lookup failed: ${error.message}`);
  }
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * The workspace's ACTIVE WhatsApp integration (enabled, Zernio or Kapso), or
 * null when it has none. `credentials` come back still encrypted — call
 * `decryptWhatsAppCredentials` only where the secret is actually needed.
 * Callers that only read settings use `loadWhatsAppSettings`.
 */
export async function loadWhatsAppIntegration(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WhatsAppIntegrationRow | null> {
  const data = await loadActiveRow(
    supabase,
    workspaceId,
    "id, provider, enabled, config, credentials",
  );
  if (!data || !isWhatsAppProvider(data.provider)) return null;

  return {
    id: data.id as string,
    provider: data.provider,
    enabled: true,
    config: (data.config ?? {}) as Record<string, unknown>,
    credentials: (data.credentials ?? null) as Record<string, unknown> | null,
  };
}

/**
 * The active WhatsApp integration WITHOUT its credentials: for the callers
 * that only read the workspace settings kept in its config (buffer window,
 * handoff acknowledgement, Jev).
 */
export async function loadWhatsAppSettings(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WhatsAppSettingsRow | null> {
  const data = await loadActiveRow(supabase, workspaceId, "id, provider, enabled, config");
  if (!data || !isWhatsAppProvider(data.provider)) return null;

  return {
    id: data.id as string,
    provider: data.provider,
    enabled: true,
    config: (data.config ?? {}) as Record<string, unknown>,
  };
}

export async function decryptWhatsAppCredentials(
  row: WhatsAppIntegrationRow,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  return decryptCredentials(row.credentials, workspaceId, row.provider);
}

/** The provider API key, whatever the provider (credentials already decrypted). */
export function whatsappApiKey(
  provider: WhatsAppProvider,
  credentials: Record<string, unknown>,
): string {
  if (provider === "zernio") return zernioApiKey();
  const key = credentials.kapso_api_key;
  return typeof key === "string" ? key : "";
}
