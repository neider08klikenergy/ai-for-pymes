"use client";

// Diálogo previo a "Conectar": muestra lo que Meta exige para el canal y
// solo deja continuar cuando el usuario confirma que lo cumple.

import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { REQUISITOS_CANAL } from "../lib/requisitos-canales";
import { CheckCircle2, ExternalLink, Info } from "lucide-react";
import type { Channel } from "@/features/inbox/components/channel-badge";

export function RequisitosConexion({
  channel,
  onClose,
  onContinue,
}: {
  /** Canal a conectar; null = cerrado. */
  channel: Channel | null;
  onClose: () => void;
  onContinue: (channel: Channel) => void;
}) {
  return (
    <Dialog open={channel !== null} onOpenChange={(open) => !open && onClose()}>
      {channel && (
        // key: al cambiar de canal la confirmación vuelve a empezar sin marcar.
        <Contenido
          key={channel}
          channel={channel}
          onClose={onClose}
          onContinue={onContinue}
        />
      )}
    </Dialog>
  );
}

function Contenido({
  channel,
  onClose,
  onContinue,
}: {
  channel: Channel;
  onClose: () => void;
  onContinue: (channel: Channel) => void;
}) {
  const [confirmado, setConfirmado] = useState(false);
  const info = REQUISITOS_CANAL[channel];
  const checkId = `requisitos-${channel}`;

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{info.titulo}</DialogTitle>
        <DialogDescription>{info.resumen}</DialogDescription>
      </DialogHeader>

      <ul className="grid gap-3">
        {info.requisitos.map((r) => (
          <li key={r.texto} className="flex gap-2.5 text-sm">
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-success"
              aria-hidden
            />
            <div className="grid gap-0.5">
              <span className="font-medium">{r.texto}</span>
              {r.como && (
                <span className="text-xs text-muted-foreground">{r.como}</span>
              )}
              {r.enlace && (
                <a
                  href={r.enlace.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {r.enlace.label}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <div className="grid gap-1">
          <span className="font-medium text-foreground">Si algo falla</span>
          {info.siFalla.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>

      <label
        htmlFor={checkId}
        className="flex cursor-pointer items-start gap-2 text-sm"
      >
        <Checkbox
          id={checkId}
          checked={confirmado}
          onCheckedChange={(v) => setConfirmado(v === true)}
          className="mt-0.5"
        />
        <span>Cumplo estos requisitos y tengo acceso a la cuenta.</span>
      </label>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={!confirmado}
          onClick={() => onContinue(channel)}
        >
          Continuar a Meta
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
