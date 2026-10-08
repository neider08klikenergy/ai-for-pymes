"use client";

import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { JudgeView } from "@/features/jev-judge/schema";
import { SAMPLE_MESSAGES } from "@/features/jev-judge/samples";
import { JEV_USES_ON, type JevUses } from "@/features/jev-judge/uses";
import { ruleCopy, type WithoutJevPreview } from "@/features/jev-judge/preview";

interface JevPanelProps {
  workspaceId: string;
  initialEnabled: boolean;
  initialUses: JevUses;
  keyReady: boolean;
  judgmentsToday: number;
  canManage: boolean;
}

export interface JevSettings {
  enabled: boolean;
  uses: JevUses;
  keyReady: boolean;
  judgmentsToday: number;
}

const USES: Array<{ key: keyof JevUses; label: string; hint: string }> = [
  {
    key: "stage",
    label: "etapa",
    hint: "elScoreMueveElContactoInteresado",
  },
  {
    key: "reply",
    label: "quienContesta",
    hint: "noulDecideSiRedactaLaIa",
  },
  {
    key: "optOut",
    label: "baja",
    hint: "siPideQueDejenDeEscribirle",
  },
];

const DECISION_LABEL = {
  respond: "Contesta el redactor",
  handoff: "Pasa a una persona",
  abstain: "No contesta",
} as const;

export function JevPanel({
  workspaceId,
  initialEnabled,
  initialUses = JEV_USES_ON,
  keyReady,
  judgmentsToday,
  canManage,
}: JevPanelProps) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.jevPanel");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [uses, setUses] = useState<JevUses>(initialUses);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState(SAMPLE_MESSAGES[0]?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [without, setWithout] = useState<WithoutJevPreview | null>(null);
  const [withJev, setWithJev] = useState<JudgeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (!canManage) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/jev`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? t("noSePudoGuardar"));
        return;
      }
      setEnabled(next);
      toast.success(next ? t("jevPrendidoParaEsteWorkspace") : t("jevApagado"));
    } catch {
      toast.error(t("errorDeConexion"));
    } finally {
      setSaving(false);
    }
  }

  async function saveUse(key: keyof JevUses, next: boolean) {
    if (!canManage) return;
    const previous = uses;
    setUses({ ...uses, [key]: next });
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/jev`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setUses(previous);
        toast.error(json.error ?? t("noSePudoGuardar"));
        return;
      }
    } catch {
      setUses(previous);
      toast.error(t("errorDeConexion"));
    } finally {
      setSaving(false);
    }
  }

  async function compare() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/jev/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json()) as {
        without?: WithoutJevPreview;
        with?: JudgeView | null;
        error?: string | null;
      };
      if (json.without) setWithout(json.without);
      setWithJev(json.with ?? null);
      setError(json.error ?? null);
      if (!res.ok && !json.without)
        toast.error(json.error ?? t("noSePudoComparar"));
    } catch {
      toast.error(t("errorDeConexion"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-lg border border-border/60 bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("jev")}</h2>
          <p className="text-sm text-muted-foreground">
            {enabled ? t("jevJuzgaElTextoElCodigo") : t("elCrmUsaLasReglasDe")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={!canManage || saving}
          aria-label={t("prenderOApagarJev")}
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <StatusPill
          ok={keyReady}
          label={keyReady ? t("jevListo") : t("faltaTypesafeApiKey")}
        />
        <StatusPill
          ok={enabled}
          label={enabled ? t("prendidoEnWhatsapp") : t("apagadoEnWhatsapp")}
        />
        <span className="rounded-full border border-border px-2 py-1 text-muted-foreground">
          {t("hoy")} {judgmentsToday} juicios
        </span>
      </div>

      <div className="space-y-3 border-t border-border/60 pt-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("paraQueUsarJev")}</p>
          <p className="text-xs text-muted-foreground">
            {t("jevSiempreClasificaIgualEstosSwitches")}
          </p>
        </div>
        {USES.map((use) => (
          <UseSwitch
            key={use.key}
            label={tc(use.label)}
            hint={tc(use.hint)}
            checked={uses[use.key]}
            disabled={!canManage || saving}
            onCheckedChange={(next) => void saveUse(use.key, next)}
          />
        ))}
      </div>

      {!canManage && (
        <p className="text-xs text-muted-foreground">
          {t("soloUnAdminOManagerPuede")}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="jev-bench-text">{t("probarUnMensaje")}</Label>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_MESSAGES.map((sample) => (
            <Button
              key={sample.id}
              type="button"
              size="sm"
              variant={text === sample.text ? "default" : "outline"}
              onClick={() => setText(sample.text)}
            >
              {tc(sample.label)}
            </Button>
          ))}
        </div>
        <Textarea
          id="jev-bench-text"
          rows={3}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("laComparacionNoEscribeElCrm")}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={compare}
          disabled={!canManage || busy || !text.trim()}
        >
          {busy && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          )}
          {busy ? t("comparando") : t("comparar")}
        </Button>
      </div>

      {(without || withJev || error) && (
        <div className="grid gap-3 md:grid-cols-2">
          <ResultCard title={t("sinJev")}>
            {without ? (
              <WithoutBody result={without} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("sinResultado")}
              </p>
            )}
          </ResultCard>
          <ResultCard title={t("conJev")}>
            {withJev ? (
              <WithBody result={withJev} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {error ?? t("sinResultado")}
              </p>
            )}
          </ResultCard>
        </div>
      )}
    </section>
  );
}

function UseSwitch({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-1 ${
        ok
          ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
          : "border-border text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

function ResultCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function WithoutBody({ result }: { result: WithoutJevPreview }) {
  const t = useTranslations("ui.jevPanel");
  return (
    <>
      <p className="text-sm font-medium">{DECISION_LABEL[result.decision]}</p>
      <p className="text-xs text-muted-foreground">
        {result.reason === "keyword"
          ? t("unaFraseDeHumanoDisparaEl")
          : t("noHayKeywordElRedactorContestaria")}
      </p>
    </>
  );
}

function WithBody({ result }: { result: JudgeView }) {
  const t = useTranslations("ui.jevPanel");
  return (
    <>
      <p className="text-sm font-medium">{DECISION_LABEL[result.decision]}</p>
      <p className="text-xs text-muted-foreground">{ruleCopy(result.rule)}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Stat
          label={t("choice")}
          value={`${result.action} · ${pct(result.actionConfidence)}`}
        />
        <Stat label={t("score")} value={result.intentScore.toFixed(2)} />
        <Stat label={t("autoReply")} value={pct(result.autoReplyProbability)} />
        <Stat label={t("optOut")} value={pct(result.optOutProbability)} />
      </dl>
      <p className="text-[11px] text-muted-foreground">
        {t("modelo")} {result.model}
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
