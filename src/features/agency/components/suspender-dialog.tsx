"use client";

// Agencia → suspender un workspace: qué pasa (y qué no) y el motivo, que
// queda en el historial de Falvrick y el cliente no ve.

import {
  Dialog,
  DialogTitle,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const MOTIVOS = ["faltaDePago", "solicitudDelCliente", "otro"] as const;
type Motivo = (typeof MOTIVOS)[number];

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function SuspenderDialog({
  nombre,
  ocupado,
  onConfirmar,
  onCerrar,
}: {
  nombre: string;
  ocupado: boolean;
  onConfirmar: (motivo: string) => void;
  onCerrar: () => void;
}) {
  const t = useTranslations("ui.workspacesTable");
  const [motivo, setMotivo] = useState<Motivo>("faltaDePago");
  const [detalle, setDetalle] = useState("");
  const texto = motivo === "otro" ? detalle.trim() : t(`motivos.${motivo}`);

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("suspenderTitulo", { nombre })}</DialogTitle>
          <DialogDescription>{t("suspenderTexto")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="suspender-motivo">{t("motivo")}</Label>
            <select
              id="suspender-motivo"
              className={SELECT_CLASS}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as Motivo)}
              disabled={ocupado}
            >
              {MOTIVOS.map((m) => (
                <option key={m} value={m}>
                  {t(`motivos.${m}`)}
                </option>
              ))}
            </select>
          </div>
          {motivo === "otro" && (
            <div className="space-y-1.5">
              <Label htmlFor="suspender-detalle">{t("cualMotivo")}</Label>
              <Input
                id="suspender-detalle"
                value={detalle}
                maxLength={500}
                onChange={(e) => setDetalle(e.target.value)}
                disabled={ocupado}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("motivoPrivado")}</p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={ocupado}
            onClick={onCerrar}
          >
            {t("cancelar")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={ocupado || !texto}
            aria-busy={ocupado}
            onClick={() => onConfirmar(texto)}
          >
            {ocupado && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {t("suspenderBoton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
