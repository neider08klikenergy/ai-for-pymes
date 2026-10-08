"use client";

import {
  Copy,
  Loader2,
  Sparkles,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CalendarDays,
  HeadphonesIcon,
} from "lucide-react";
import {
  WHATSAPP_LABEL,
  e164FromDisplay,
  KapsoNumberSelect,
  describeKapsoNumber,
  WhatsAppProviderPicker,
  type KapsoNumberOption,
  type WhatsAppProviderId,
} from "@/features/settings/components/whatsapp-provider-picker";
import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { completeOnboarding } from "../services/onboarding-actions";
import type { OnboardingInput } from "../services/onboarding-actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type UseCase = "setter" | "soporte" | "agendamiento" | "general";

interface WizardState {
  useCase: UseCase | null;
  businessName: string;
  industry: string;
  description: string;
  whatsappProvider: Exclude<WhatsAppProviderId, "zernio">;
  whatsappApiKey: string;
  whatsappPhone: string;
  whatsappSigningSecret: string;
  /** Kapso only: Meta's phone number id (what actually sends) */
  kapsoPhoneNumberId: string;
  /** Kapso only: WhatsApp Business Account id (templates) */
  kapsoWabaId: string;
}

// ─── Use case cards data ──────────────────────────────────────────────────────

const USE_CASES: {
  id: UseCase;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "setter",
    label: "setterVentas",
    description: "calificaLeadsAgendaCitasYCierra",
    icon: <TrendingUp className="h-5 w-5" aria-hidden />,
  },
  {
    id: "soporte",
    label: "soporteAlCliente",
    description:
      "Resuelve dudas, gestiona tickets y escala a humanos cuando es necesario.",
    icon: <HeadphonesIcon className="h-5 w-5" aria-hidden />,
  },
  {
    id: "agendamiento",
    label: "agendamiento",
    description:
      "Reserva y confirma citas de forma automática con tus clientes.",
    icon: <CalendarDays className="h-5 w-5" aria-hidden />,
  },
  {
    id: "general",
    label: "general",
    description:
      "Asistente virtual flexible para responder preguntas y dar información.",
    icon: <Sparkles className="h-5 w-5" aria-hidden />,
  },
];

// ─── Progress bar ─────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={[
            "h-1.5 flex-1 rounded-full transition-colors duration-300",
            i < current
              ? "bg-primary"
              : i === current
                ? "bg-primary/60"
                : "bg-muted",
          ].join(" ")}
          aria-hidden
        />
      ))}
      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
        {current + 1} / {total}
      </span>
    </div>
  );
}

// ─── Step 1 — Use case selection ──────────────────────────────────────────────

function Step1({
  selected,
  onSelect,
}: {
  selected: UseCase | null;
  onSelect: (id: UseCase) => void;
}) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.onboardingWizard");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t("paraQueUsarasElAgente")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("estoConfiguraraElPromptInicialDe")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {USE_CASES.map((uc) => (
          <button
            key={uc.id}
            type="button"
            onClick={() => onSelect(uc.id)}
            className={[
              "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all",
              "hover:border-primary/60 hover:bg-primary/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === uc.id
                ? "border-primary bg-primary/10 ring-1 ring-primary"
                : "border-border bg-card",
            ].join(" ")}
            aria-pressed={selected === uc.id}
          >
            <span
              className={[
                "flex h-9 w-9 items-center justify-center rounded-lg",
                selected === uc.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {uc.icon}
            </span>
            <span className="font-medium text-foreground text-sm">
              {tc(uc.label)}
            </span>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {tc(uc.description)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2 — Business info ───────────────────────────────────────────────────

function Step2({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.onboardingWizard");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t("informacionDelNegocio")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("elAgenteUsaraEstosDatosPara")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="business-name">
            {t("nombreDelNegocio")} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="business-name"
            placeholder={t("clinicaSonrisaPerfecta")}
            value={state.businessName}
            onChange={(e) => onChange({ businessName: e.target.value })}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="industry">{t("industriaGiro")}</Label>
          <Input
            id="industry"
            placeholder={t("saludDentalECommerceBienesRaices")}
            value={state.industry}
            onChange={(e) => onChange({ industry: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">{t("descripcionBreve")}</Label>
          <Textarea
            id="description"
            placeholder={t("somosUnaClinicaDentalEnCancun")}
            value={tc(state.description)}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            {t("estaDescripcionEnriqueceElPromptBase")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3 — WhatsApp connection (YCloud or Kapso) ───────────────────────────

function Step3({
  state,
  onChange,
  isTesting,
  onTest,
  kapsoChoices,
  onPickKapsoNumber,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  isTesting: boolean;
  onTest: () => void;
  kapsoChoices: KapsoNumberOption[];
  onPickKapsoNumber: (n: KapsoNumberOption) => void;
}) {
  const t = useTranslations("ui.onboardingWizard");
  const [copied, setCopied] = useState(false);
  const provider = state.whatsappProvider;
  const label = WHATSAPP_LABEL[provider];

  const webhookPlaceholder =
    "[Se generará al guardar — podrás copiarlo desde Configuración]";

  function handleCopy() {
    navigator.clipboard.writeText(webhookPlaceholder).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t("conectarWhatsapp")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("opcionalPodrasConfigurarEstoMasTarde")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label id="onboarding-provider-label">{t("proveedor")}</Label>
          <WhatsAppProviderPicker
            value={provider}
            options={["ycloud", "kapso"]}
            onChange={(p) => {
              if (p === provider || p === "zernio") return;
              // Keys, secrets and Meta ids belong to one provider: never send
              // YCloud's key to Kapso's test (or the other way around).
              onChange({
                whatsappProvider: p,
                whatsappApiKey: "",
                whatsappSigningSecret: "",
                kapsoPhoneNumberId: "",
                kapsoWabaId: "",
              });
            }}
            labelledBy="onboarding-provider-label"
          />
          <p className="text-xs text-muted-foreground">
            {t("siTuNumeroOTusClientes")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="whatsapp-key">
            {t("apiKey")} {label}
          </Label>
          <Input
            id="whatsapp-key"
            type="password"
            placeholder={provider === "kapso" ? "kapso_..." : "yk_..."}
            value={state.whatsappApiKey}
            onChange={(e) => onChange({ whatsappApiKey: e.target.value })}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="whatsapp-phone">{t("numeroDeWhatsappE164")}</Label>
          <Input
            id="whatsapp-phone"
            type="tel"
            placeholder="+521234567890"
            value={state.whatsappPhone}
            onChange={(e) => onChange({ whatsappPhone: e.target.value })}
          />
        </div>

        {provider === "kapso" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="kapso-phone-number-id">
                {t("phoneNumberIdMeta")}
              </Label>
              <Input
                id="kapso-phone-number-id"
                inputMode="numeric"
                placeholder="123456789012345"
                value={state.kapsoPhoneNumberId}
                onChange={(e) =>
                  onChange({ kapsoPhoneNumberId: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                {t("seAutocompletaAlProbarLaConexion")}
              </p>
            </div>
            {kapsoChoices.length > 0 && (
              <KapsoNumberSelect
                id="onboarding-kapso-number"
                numbers={kapsoChoices}
                value={state.kapsoPhoneNumberId}
                onPick={onPickKapsoNumber}
              />
            )}
            <div className="space-y-2">
              <Label htmlFor="kapso-waba-id">{t("wabaId")}</Label>
              <Input
                id="kapso-waba-id"
                inputMode="numeric"
                placeholder="123456789012345"
                value={state.kapsoWabaId}
                onChange={(e) => onChange({ kapsoWabaId: e.target.value })}
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="whatsapp-secret">{t("webhookSigningSecret")}</Label>
          <Input
            id="whatsapp-secret"
            type="password"
            placeholder="whsec_..."
            value={state.whatsappSigningSecret}
            onChange={(e) =>
              onChange({ whatsappSigningSecret: e.target.value })
            }
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label>{t("webhookUrl")}</Label>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={webhookPlaceholder}
              className="font-mono text-xs text-muted-foreground"
              aria-label={t("webhookUrlSeGeneraraAlFinalizar")}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              aria-label={t("copiarTexto")}
            >
              {copied ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("laUrlRealSeMostraraEn")}
          </p>
        </div>

        {state.whatsappApiKey && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={isTesting}
            aria-busy={isTesting}
          >
            {isTesting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
            ) : null}
            {t("probarConexion")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Step 4 — Summary ─────────────────────────────────────────────────────────

function Step4({
  state,
  workspaceId,
}: {
  state: WizardState;
  workspaceId: string;
}) {
  const t = useTranslations("ui.onboardingWizard");
  const tc = useTranslations("ui.constantes");
  const useCaseLabel = (() => {
    const uc = USE_CASES.find((u) => u.id === state.useCase);
    return uc ? tc(uc.label) : (state.useCase ?? "");
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center gap-3 py-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden />
        </span>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t("todoListo")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("tuWorkspaceHaSidoCreadoAqui")}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        <Row label={t("negocio")} value={state.businessName} />
        {state.industry && (
          <Row label={t("industria")} value={state.industry} />
        )}
        <Row label={t("tipoDeAgente")} value={useCaseLabel} />
        <Row label={t("promptInicial")} value="Generado automáticamente" />
        {state.whatsappApiKey && (
          <Row
            label={WHATSAPP_LABEL[state.whatsappProvider]}
            value="Credenciales guardadas"
          />
        )}
        <Row
          label={t("webhookUrl")}
          value={`/api/webhooks/${state.whatsappProvider}?wsid=${workspaceId}`}
          mono
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t("puedesAjustarTodoEstoEnConfiguracion")}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span
        className={[
          "text-xs text-right text-foreground",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

export function OnboardingWizard() {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.onboardingWizard");
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  // Kapso numbers to choose from when the project has more than one.
  const [kapsoChoices, setKapsoChoices] = useState<KapsoNumberOption[]>([]);
  const [completedWorkspaceId, setCompletedWorkspaceId] = useState<
    string | null
  >(null);

  const [state, setState] = useState<WizardState>({
    useCase: null,
    businessName: "",
    industry: "",
    description: "",
    whatsappProvider: "ycloud",
    whatsappApiKey: "",
    whatsappPhone: "",
    whatsappSigningSecret: "",
    kapsoPhoneNumberId: "",
    kapsoWabaId: "",
  });

  function patch(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
    // Numbers listed for one key (or provider) mean nothing for another.
    if ("whatsappApiKey" in update || "whatsappProvider" in update) {
      setKapsoChoices([]);
    }
  }

  function canAdvance(): boolean {
    if (step === 0) return state.useCase !== null;
    if (step === 1) return state.businessName.trim().length > 0;
    return true;
  }

  async function handleNext() {
    if (step === 2) {
      // Finalize — call server action
      await handleFinalize();
      return;
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleFinalize() {
    setIsSubmitting(true);
    try {
      const input: OnboardingInput = {
        useCase: state.useCase!,
        businessName: state.businessName.trim(),
        industry: state.industry.trim() || undefined,
        description: tc(state.description).trim() || undefined,
        whatsappProvider: state.whatsappProvider,
        whatsappApiKey: state.whatsappApiKey.trim() || undefined,
        whatsappPhone: state.whatsappPhone.trim() || undefined,
        whatsappSigningSecret: state.whatsappSigningSecret.trim() || undefined,
        kapsoPhoneNumberId: state.kapsoPhoneNumberId.trim() || undefined,
        kapsoWabaId: state.kapsoWabaId.trim() || undefined,
      };

      const result = await completeOnboarding(input);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setCompletedWorkspaceId(result.workspaceId ?? null);
      setStep(3);
    } catch (err) {
      console.error("[OnboardingWizard] handleFinalize error:", err);
      toast.error(t("errorInesperadoAlCrearElWorkspace"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTestConnection() {
    if (!state.whatsappApiKey) return;
    const provider = state.whatsappProvider;
    const label = WHATSAPP_LABEL[provider];
    setIsTesting(true);
    try {
      // Proxy through the server so the API key isn't exposed to the browser
      // and the request isn't CORS-blocked.
      const res = await fetch(`/api/integrations/${provider}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: state.whatsappApiKey }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        balance?: { balance?: number; currency?: string };
        phoneNumbers?: KapsoNumberOption[];
        error?: string;
      };
      if (!json.ok) {
        toast.error(json.error ?? t("apiKeyInvalidaOSinAcceso"));
        return;
      }
      if (provider === "kapso") {
        // Kapso lists the project's numbers (connected production first).
        // With one, fill in the Meta ids the user would otherwise copy by
        // hand; with several, let them choose — it may be another client's.
        const numbers = json.phoneNumbers ?? [];
        if (numbers.length > 1 && !state.kapsoPhoneNumberId) {
          setKapsoChoices(numbers);
          toast.success(
            `${label} conectado — hay ${numbers.length} números en el proyecto: elige el de este negocio`,
          );
          return;
        }
        const first = numbers[0];
        patch({
          kapsoPhoneNumberId:
            state.kapsoPhoneNumberId || first?.phone_number_id || "",
          kapsoWabaId: state.kapsoWabaId || first?.waba_id || "",
          whatsappPhone:
            state.whatsappPhone || e164FromDisplay(first?.display_phone_number),
        });
        toast.success(
          `${label} conectado${first ? ` — ${describeKapsoNumber(first)}` : ""}`,
        );
      } else {
        const balance =
          typeof json.balance?.balance === "number"
            ? json.balance.balance
            : "?";
        const currency = json.balance?.currency ?? "";
        toast.success(`${label} conectado — Saldo: ${balance} ${currency}`);
      }
    } catch {
      toast.error(`No se pudo conectar con ${label}`);
    } finally {
      setIsTesting(false);
    }
  }

  const isLastDataStep = step === 2;
  const isComplete = step === 3;

  return (
    <div className="w-full max-w-lg mx-auto">
      <StepIndicator current={step} total={TOTAL_STEPS} />

      {step === 0 && (
        <Step1
          selected={state.useCase}
          onSelect={(id) => patch({ useCase: id })}
        />
      )}
      {step === 1 && <Step2 state={state} onChange={patch} />}
      {step === 2 && (
        <Step3
          state={state}
          onChange={patch}
          isTesting={isTesting}
          onTest={handleTestConnection}
          kapsoChoices={state.whatsappProvider === "kapso" ? kapsoChoices : []}
          onPickKapsoNumber={(n) => {
            patch({
              kapsoPhoneNumberId: n.phone_number_id ?? "",
              kapsoWabaId: n.waba_id ?? "",
              whatsappPhone:
                e164FromDisplay(n.display_phone_number) || state.whatsappPhone,
            });
            setKapsoChoices([]);
            toast.info(`Elegiste ${describeKapsoNumber(n)}`);
          }}
        />
      )}
      {step === 3 && completedWorkspaceId && (
        <Step4 state={state} workspaceId={completedWorkspaceId} />
      )}

      <div className="flex items-center justify-between mt-8">
        {step > 0 && !isComplete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleBack}
            disabled={isSubmitting}
          >
            <ChevronLeft className="h-4 w-4 mr-1" aria-hidden />
            {t("atras")}
          </Button>
        ) : (
          <div />
        )}

        {!isComplete ? (
          <Button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance() || isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
            ) : null}
            {isLastDataStep ? t("finalizar") : t("continuar")}
            {!isLastDataStep && !isSubmitting && (
              <ChevronRight className="h-4 w-4 ml-1" aria-hidden />
            )}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => router.push("/inbox")}
            className="w-full sm:w-auto"
          >
            {t("irAlInbox")}
            <ChevronRight className="h-4 w-4 ml-1" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
