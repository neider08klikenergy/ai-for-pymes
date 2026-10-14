"use client";

// Confirmación para acciones delicadas (quitar acceso, cambiar un rol,
// cancelar una invitación, eliminar un workspace): un clic no basta.
// Con `textoAEscribir`, además hay que escribirlo para poder confirmar.

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function ConfirmarDialog({
  abierto,
  titulo,
  descripcion,
  textoConfirmar,
  textoVolver,
  destructivo = false,
  ocupado = false,
  textoAEscribir,
  etiquetaEscribir,
  onConfirmar,
  onCerrar,
}: {
  abierto: boolean;
  titulo: string;
  descripcion: string;
  textoConfirmar: string;
  textoVolver: string;
  destructivo?: boolean;
  ocupado?: boolean;
  /** Para lo irreversible: hay que escribir esto (p. ej. el nombre) para confirmar. */
  textoAEscribir?: string;
  etiquetaEscribir?: string;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const [escrito, setEscrito] = useState("");
  const coincide = !textoAEscribir || escrito.trim() === textoAEscribir.trim();

  function cerrar() {
    setEscrito("");
    onCerrar();
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && !ocupado && cerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        {textoAEscribir && (
          <div className="space-y-1.5">
            <Label htmlFor="confirmar-escribir">
              {etiquetaEscribir}{" "}
              <span className="font-mono font-semibold">{textoAEscribir}</span>
            </Label>
            <Input
              id="confirmar-escribir"
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              autoComplete="off"
              disabled={ocupado}
            />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={ocupado}
            onClick={cerrar}
          >
            {textoVolver}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={destructivo ? "destructive" : "default"}
            disabled={ocupado || !coincide}
            aria-busy={ocupado}
            onClick={onConfirmar}
          >
            {ocupado && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
