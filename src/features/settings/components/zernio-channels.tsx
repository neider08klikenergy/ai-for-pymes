"use client";

// Canales del workspace en Zernio: WhatsApp, Instagram y Facebook Messenger.
// Cada botón "Conectar" abre la página oficial de Meta (vía Zernio); el
// cliente inicia sesión ahí y nunca nos da su contraseña.

import {
  type Channel,
  ChannelBadge,
  CHANNEL_LABEL,
} from "@/features/inbox/components/channel-badge";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RequisitosConexion } from "./requisitos-conexion";
import { Link2, Loader2, RefreshCw, Unlink } from "lucide-react";

export interface ZernioAccountView {
  id: string;
  platform: string;
  username: string | null;
  display_name: string | null;
}

const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook"];

const AYUDA: Record<Channel, string> = {
  whatsapp: "Número de WhatsApp Business del negocio.",
  instagram: "Cuenta profesional (empresa o creador) de Instagram.",
  facebook: "Página de Facebook del negocio (Messenger).",
};

export function ZernioChannels({
  workspaceId,
  canEdit,
  initialAccounts,
  onAccountsChange,
}: {
  workspaceId: string;
  canEdit: boolean;
  initialAccounts: ZernioAccountView[];
  onAccountsChange: (accounts: ZernioAccountView[]) => void;
}) {
  const [accounts, setAccounts] =
    useState<ZernioAccountView[]>(initialAccounts);
  const [busy, setBusy] = useState<string | null>(null);
  const [env, setEnv] = useState<{
    apiKey: boolean;
    webhookSecret: boolean;
  } | null>(null);
  // Canal cuyo diálogo de requisitos está abierto (antes de ir a Meta).
  const [revisando, setRevisando] = useState<Channel | null>(null);

  function update(next: ZernioAccountView[]) {
    setAccounts(next);
    onAccountsChange(next);
  }

  async function refresh(silent = false) {
    setBusy("refresh");
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/zernio/accounts`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        accounts?: ZernioAccountView[];
        env?: { apiKey: boolean; webhookSecret: boolean };
        error?: string;
      };
      if (json.env) setEnv(json.env);
      if (!res.ok) {
        if (!silent) toast.error(json.error ?? "No se pudo leer Zernio");
        return;
      }
      update(json.accounts ?? []);
      if (!silent) toast.success("Canales actualizados");
    } catch {
      if (!silent) toast.error("Error de red al leer Zernio");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    // Primera lectura en un callback (no síncrona dentro del efecto).
    const t = setTimeout(() => void refresh(true), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function connect(platform: Channel) {
    setBusy(platform);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/zernio/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const json = (await res.json()) as { authUrl?: string; error?: string };
      if (!res.ok || !json.authUrl) {
        toast.error(json.error ?? "No se pudo iniciar la conexión");
        setBusy(null);
        return;
      }
      // Se va a la página de Meta; al volver, /settings muestra el resultado.
      window.location.assign(json.authUrl);
    } catch {
      toast.error("Error de red al iniciar la conexión");
      setBusy(null);
    }
  }

  async function disconnect(account: ZernioAccountView) {
    setBusy(account.id);
    try {
      const res = await fetch(
        `/api/workspace/${workspaceId}/zernio/accounts/${account.id}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as {
        accounts?: ZernioAccountView[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo desconectar");
        return;
      }
      update(json.accounts ?? accounts.filter((a) => a.id !== account.id));
      toast.success("Canal desconectado");
    } catch {
      toast.error("Error de red al desconectar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      {env && (!env.apiKey || !env.webhookSecret) && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          Falta configurar en Vercel{" "}
          {[
            !env.apiKey && "ZERNIO_API_KEY",
            !env.webhookSecret && "ZERNIO_WEBHOOK_SECRET",
          ]
            .filter(Boolean)
            .join(" y ")}
          . Sin eso no se puede conectar ni recibir mensajes.
        </p>
      )}
      <ul className="divide-y divide-border/50 rounded-md border border-border/50">
        {CHANNELS.map((channel) => {
          const conectadas = accounts.filter((a) => a.platform === channel);
          return (
            <li
              key={channel}
              className="flex flex-wrap items-center gap-3 px-3 py-2.5"
            >
              <ChannelBadge channel={channel} withLabel />
              <div className="min-w-0 flex-1">
                {conectadas.length > 0 ? (
                  conectadas.map((a) => (
                    <p key={a.id} className="text-sm font-medium">
                      {a.display_name ?? a.username ?? a.id}
                      {a.username &&
                        a.display_name &&
                        a.username !== a.display_name && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {a.username}
                          </span>
                        )}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {AYUDA[channel]} Sin conectar.
                  </p>
                )}
              </div>
              {conectadas.length > 0 ? (
                conectadas.map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit || busy !== null}
                    onClick={() => void disconnect(a)}
                    aria-label={`Desconectar ${CHANNEL_LABEL[channel]}`}
                  >
                    {busy === a.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Unlink className="h-4 w-4" aria-hidden />
                    )}
                    <span className="ml-1.5">Desconectar</span>
                  </Button>
                ))
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || busy !== null}
                  onClick={() => setRevisando(channel)}
                >
                  {busy === channel ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Link2 className="h-4 w-4" aria-hidden />
                  )}
                  <span className="ml-1.5">Conectar</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <RequisitosConexion
        channel={revisando}
        onClose={() => setRevisando(null)}
        onContinue={(c) => {
          setRevisando(null);
          void connect(c);
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={busy === "refresh" ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            aria-hidden
          />
          <span className="ml-1.5">Actualizar</span>
        </Button>
        <p className="text-xs text-muted-foreground">
          Al conectar se abre la página oficial de Meta: el dueño de la cuenta
          inicia sesión ahí.
        </p>
      </div>
    </div>
  );
}
