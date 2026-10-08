"use client";

import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogContent,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectValue,
  SelectTrigger,
  SelectContent,
} from "@/components/ui/select";
import { useState } from "react";
import { Calculator } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// ── Price table (Meta 2024 approximate, USD per template message) ─────────────

const PRICES: Record<string, Record<string, number>> = {
  marketing: {
    MX: 0.0125,
    PA: 0.0115,
    ES: 0.0162,
    CO: 0.011,
  },
  utility: {
    MX: 0.0063,
    PA: 0.0058,
    ES: 0.008,
    CO: 0.0055,
  },
  authentication: {
    MX: 0.0063,
    PA: 0.0058,
    ES: 0.008,
    CO: 0.0055,
  },
};

const COUNTRIES = [
  { value: "MX", label: "mexico" },
  { value: "PA", label: "panama" },
  { value: "ES", label: "espana" },
  { value: "CO", label: "colombia" },
] as const;

type CountryCode = (typeof COUNTRIES)[number]["value"];

// ── Formatter ─────────────────────────────────────────────────────────────────

function fmt(usd: number) {
  return usd.toLocaleString("es-MX", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

// ── Calculator content (separated so it only renders when dialog is open) ────

function CalculatorContent() {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.costCalculator");
  const [volume, setVolume] = useState(1000);
  const [type, setType] = useState<"marketing" | "utility">("utility");
  const [country, setCountry] = useState<CountryCode>("MX");

  const pricePerMsg = PRICES[type]?.[country] ?? 0.006;
  const monthlyCost = volume * pricePerMsg;

  return (
    <div className="space-y-6 pt-2">
      {/* Volume slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-foreground">
            {t("mensajesPorMes")}
          </Label>
          <span className="font-mono text-sm font-bold text-foreground tabular-nums">
            {volume.toLocaleString("es-MX")}
          </span>
        </div>
        <input
          type="range"
          min={100}
          max={100000}
          step={100}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-full h-1.5 rounded-full cursor-pointer accent-primary"
          aria-label={t("mensajesPorMes")}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>100</span>
          <span>100,000</span>
        </div>
      </div>

      {/* Type select */}
      <div className="space-y-2">
        <Label
          htmlFor="calc-type"
          className="text-sm font-medium text-foreground"
        >
          {t("tipoDeTemplate")}
        </Label>
        <Select
          value={type}
          onValueChange={(v) => setType(v as "marketing" | "utility")}
        >
          <SelectTrigger id="calc-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="utility">{t("utilidad")}</SelectItem>
            <SelectItem value="marketing">{t("marketing")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Country select */}
      <div className="space-y-2">
        <Label
          htmlFor="calc-country"
          className="text-sm font-medium text-foreground"
        >
          {t("paisDestino")}
        </Label>
        <Select
          value={country}
          onValueChange={(v) => setCountry(v as CountryCode)}
        >
          <SelectTrigger id="calc-country">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {tc(c.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Result */}
      <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("estimadoMensual")}
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {volume.toLocaleString("es-MX")} {t("msgs")} {fmt(pricePerMsg)}
            </span>
            <span className="font-mono font-semibold text-foreground tabular-nums">
              {fmt(monthlyCost)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t("mensajesDentroDeVentana24h")}
            </span>
            <span className="font-mono font-semibold text-primary tabular-nums">
              {t("gratis")}
            </span>
          </div>
        </div>

        <div className="border-t border-border pt-3 flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">
            {t("totalEstimadoMes")}
          </span>
          <span className="font-mono text-xl font-extrabold text-foreground tabular-nums">
            {fmt(monthlyCost)}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("estimadoPrecioMeta2024AproximadoLos")}
        </p>
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export function CostCalculator() {
  const t = useTranslations("ui.costCalculator");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Calculator className="h-4 w-4 mr-2" aria-hidden="true" />
          {t("calculadoraDeCostos")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {t("calculadoraDeCostosWhatsapp")}
          </DialogTitle>
          <DialogDescription>
            {t("estimaElCostoMensualDeTus")}
          </DialogDescription>
        </DialogHeader>
        <CalculatorContent />
      </DialogContent>
    </Dialog>
  );
}
