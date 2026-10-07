// Relación workspace ↔ perfil de Zernio ↔ cuentas conectadas.
//
// Todo vive en la fila `integrations` del proveedor 'zernio' del workspace:
//   config.profile_id   perfil de Zernio de este workspace
//   config.accounts     [{ id, platform, username, display_name }]
//   config.account_ids  ids de las cuentas (índice GIN para enrutar webhooks)

import { APP_NAME } from "@/lib/branding";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProfile, listAccounts, type ZernioAccount } from "./zernio-client";

export interface ZernioAccountConfig {
  id: string;
  platform: string;
  username: string | null;
  display_name: string | null;
}

export interface ZernioIntegration {
  workspaceId: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export function accountsOf(config: Record<string, unknown>): ZernioAccountConfig[] {
  return Array.isArray(config.accounts) ? (config.accounts as ZernioAccountConfig[]) : [];
}

async function loadRow(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ enabled: boolean; config: Record<string, unknown> } | null> {
  const { data, error } = await supabase
    .from("integrations")
    .select("enabled, config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "zernio")
    .maybeSingle();
  if (error) throw new Error(`[zernio] integration lookup failed: ${error.message}`);
  if (!data) return null;
  return { enabled: Boolean(data.enabled), config: (data.config ?? {}) as Record<string, unknown> };
}

async function writeConfig(
  supabase: SupabaseClient,
  workspaceId: string,
  config: Record<string, unknown>,
  exists: boolean,
): Promise<void> {
  if (exists) {
    const { error } = await supabase
      .from("integrations")
      .update({ config, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("provider", "zernio");
    if (error) throw new Error(`[zernio] config update failed: ${error.message}`);
    return;
  }
  // Fila nueva, apagada: se activa con "Guardar y cambiar a Zernio".
  const { error } = await supabase.from("integrations").insert({
    workspace_id: workspaceId,
    provider: "zernio",
    enabled: false,
    credentials: {},
    config,
  });
  if (error) throw new Error(`[zernio] integration insert failed: ${error.message}`);
}

/** El perfil de Zernio del workspace; lo crea la primera vez. */
export async function ensureZernioProfile(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const row = await loadRow(supabase, workspaceId);
  const existing = row?.config.profile_id;
  if (typeof existing === "string" && existing) return existing;

  const { data: ws } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  const name = `${(ws?.name as string | undefined) ?? "Workspace"} · ${workspaceId.slice(0, 8)}`;
  const profileId = await createProfile(name, `${APP_NAME} · workspace ${workspaceId}`);

  await writeConfig(
    supabase,
    workspaceId,
    { ...(row?.config ?? {}), profile_id: profileId, accounts: [], account_ids: [] },
    Boolean(row),
  );
  return profileId;
}

function toConfig(a: ZernioAccount): ZernioAccountConfig {
  return { id: a.id, platform: a.platform, username: a.username, display_name: a.displayName };
}

/** Relee de Zernio las cuentas del perfil y las guarda en el workspace. */
export async function syncZernioAccounts(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ZernioAccountConfig[]> {
  const row = await loadRow(supabase, workspaceId);
  const profileId = row?.config.profile_id;
  if (!row || typeof profileId !== "string" || !profileId) return [];

  const accounts = (await listAccounts(profileId)).filter((a) => a.isActive).map(toConfig);
  await writeConfig(
    supabase,
    workspaceId,
    { ...row.config, accounts, account_ids: accounts.map((a) => a.id) },
    true,
  );
  return accounts;
}

/**
 * El workspace dueño de una cuenta de Zernio (o de su perfil). Solo lectura:
 * el webhook decide después si la integración está activa.
 */
export async function findZernioWorkspace(
  supabase: SupabaseClient,
  accountId: string | null,
  profileId: string | null,
): Promise<ZernioIntegration | null> {
  if (accountId) {
    const { data, error } = await supabase
      .from("integrations")
      .select("workspace_id, enabled, config")
      .eq("provider", "zernio")
      .contains("config", { account_ids: [accountId] })
      .limit(2);
    if (error) throw new Error(`[zernio] routing lookup failed: ${error.message}`);
    // Una cuenta pertenece a un solo perfil: dos filas es una inconsistencia.
    if (data && data.length === 1) {
      return {
        workspaceId: data[0].workspace_id as string,
        enabled: Boolean(data[0].enabled),
        config: (data[0].config ?? {}) as Record<string, unknown>,
      };
    }
  }
  if (profileId) {
    const { data, error } = await supabase
      .from("integrations")
      .select("workspace_id, enabled, config")
      .eq("provider", "zernio")
      .eq("config->>profile_id", profileId)
      .limit(2);
    if (error) throw new Error(`[zernio] routing lookup failed: ${error.message}`);
    if (data && data.length === 1) {
      return {
        workspaceId: data[0].workspace_id as string,
        enabled: Boolean(data[0].enabled),
        config: (data[0].config ?? {}) as Record<string, unknown>,
      };
    }
  }
  return null;
}

/** Agrega o quita una cuenta según el evento de Zernio. */
export async function applyAccountEvent(
  supabase: SupabaseClient,
  workspaceId: string,
  config: Record<string, unknown>,
  event: { kind: "connected" | "disconnected"; accountId: string; platform: string | null; username: string | null; displayName: string | null },
): Promise<void> {
  const current = accountsOf(config).filter((a) => a.id !== event.accountId);
  const accounts =
    event.kind === "connected" && event.platform
      ? [
          ...current,
          {
            id: event.accountId,
            platform: event.platform,
            username: event.username,
            display_name: event.displayName,
          },
        ]
      : current;
  await writeConfig(
    supabase,
    workspaceId,
    { ...config, accounts, account_ids: accounts.map((a) => a.id) },
    true,
  );
}
