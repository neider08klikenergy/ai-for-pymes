"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";

// Shared by Settings → Integraciones and the onboarding wizard.

export type WhatsAppProviderId = "zernio" | "kapso";

const OPTIONS: readonly WhatsAppProviderId[] = ["zernio", "kapso"];

export const WHATSAPP_LABEL: Record<WhatsAppProviderId, string> = {
  zernio: "Zernio",
  kapso: "Kapso",
};

/**
 * Zernio / Kapso as selectable cards (a radio group): each says which
 * channels it connects and what it needs, so the choice is informed. Keyboard follows the ARIA radio
 * pattern: a single tab stop, and the arrow keys move to (and select) the
 * other option.
 */
export function WhatsAppProviderPicker({
  value,
  onChange,
  active = null,
  labelledBy,
  options = OPTIONS,
}: {
  value: WhatsAppProviderId;
  onChange: (provider: WhatsAppProviderId) => void;
  /** The provider the workspace uses today, tagged "activo". */
  active?: WhatsAppProviderId | null;
  labelledBy: string;
  /** Proveedores a mostrar (el onboarding no ofrece Zernio: se conecta después). */
  options?: readonly WhatsAppProviderId[];
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next]);
    buttons.current[next]?.focus();
  }

  const t = useTranslations("ui.integrationsTab");
  const info: Record<WhatsAppProviderId, { canales: string; detalle: string }> =
    {
      zernio: { canales: t("canalesZernio"), detalle: t("detalleZernio") },
      kapso: { canales: t("canalesKapso"), detalle: t("detalleKapso") },
    };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid gap-3 sm:grid-cols-2"
    >
      {options.map((p, i) => {
        const elegido = value === p;
        return (
          <button
            key={p}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={elegido}
            tabIndex={elegido ? 0 : -1}
            onClick={() => onChange(p)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              "relative flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              elegido
                ? "border-primary bg-primary/5"
                : "border-border/60 hover:border-border hover:bg-muted/30",
            )}
          >
            <span className="flex w-full items-center gap-2">
              <span className="font-semibold">{WHATSAPP_LABEL[p]}</span>
              {active === p && (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                  {t("enUso")}
                </span>
              )}
              {elegido && (
                <Check
                  className="ml-auto h-4 w-4 text-primary"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="text-sm text-foreground">{info[p].canales}</span>
            <span className="text-xs text-muted-foreground">
              {info[p].detalle}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Kapso: pick the workspace's number from the project ──────────────────────

/** A number as the Kapso connection tests return it. */
export type KapsoNumberOption = {
  phone_number_id?: string;
  waba_id?: string;
  display_phone_number?: string | null;
  verified_name?: string | null;
  kind?: string | null;
};

/** "+1 555-000-0001 · Cliente A (sandbox)" — what a person recognises. */
export function describeKapsoNumber(n: KapsoNumberOption): string {
  const main =
    n.display_phone_number || n.phone_number_id || "número sin nombre";
  const name = n.verified_name ? ` · ${n.verified_name}` : "";
  const sandbox = n.kind === "sandbox" ? " (sandbox)" : "";
  return `${main}${name}${sandbox}`;
}

/** Meta's display number ("+1 555-000-0001") as E.164 ("+15550000001"). */
export function e164FromDisplay(display: string | null | undefined): string {
  const digits = (display ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Shown when the Kapso project has more than one number (another client's, a
 * sandbox): the workspace's number is chosen, never assumed.
 */
export function KapsoNumberSelect({
  id,
  numbers,
  value,
  onPick,
}: {
  id: string;
  numbers: KapsoNumberOption[];
  value: string;
  onPick: (n: KapsoNumberOption) => void;
}) {
  const t = useTranslations("ui.whatsappProviderPicker");
  const known = numbers.some((n) => n.phone_number_id === value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("numerosDelProyectoDeKapso")}</Label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={known ? value : ""}
        onChange={(e) => {
          const picked = numbers.find(
            (n) => n.phone_number_id === e.target.value,
          );
          if (picked) onPick(picked);
        }}
      >
        <option value="" disabled>
          {t("eligeElNumeroDeEsteWorkspace")}
        </option>
        {numbers.map((n) => (
          <option key={n.phone_number_id} value={n.phone_number_id}>
            {describeKapsoNumber(n)}
          </option>
        ))}
      </select>
    </div>
  );
}
