"use client";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PedidoFila } from "../types";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { ResultadoAccion } from "../services/pedidos-actions";
import { ESTADO_COLOR, ESTADO_LABEL, type EstadoPedido } from "../lib/estados";

/** Texto del botón que avanza el pedido al siguiente estado de producción. */
export const ACCION_SIGUIENTE: Partial<Record<EstadoPedido, string>> = {
  confirmado: "Pasar a producción",
  en_produccion: "Marcar listo",
  listo: "Marcar entregado",
};

const LINEA_LABEL: Record<string, string> = {
  ponque_personalizado: "Ponqué",
  porcion: "Porción",
  largo: "Ponqué largo",
  golovesa: "Golovesa",
  golotarta: "Golotarta",
  helado: "Helado",
};

export function nombreProducto(
  p: Pick<PedidoFila, "linea" | "sabor" | "tamano" | "cantidad">,
): string {
  const linea = LINEA_LABEL[p.linea] ?? p.linea.replace(/_/g, " ");
  const sabor = p.sabor && p.sabor !== "N/A" ? ` ${p.sabor}` : "";
  const cant = p.cantidad > 1 ? ` ×${p.cantidad}` : "";
  return `${linea}${sabor} · ${p.tamano}${cant}`;
}

export function EstadoBadge({
  estado,
  className,
}: {
  estado: EstadoPedido;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        ESTADO_COLOR[estado],
        className,
      )}
    >
      {ESTADO_LABEL[estado]}
    </span>
  );
}

/** Color sólido por estado, para los puntos del calendario. */
export const ESTADO_PUNTO: Record<EstadoPedido, string> = {
  pendiente_anticipo: "bg-muted-foreground/60",
  por_verificar: "bg-warning",
  confirmado: "bg-info",
  en_produccion: "bg-primary",
  listo: "bg-success",
  entregado: "bg-muted-foreground/30",
  cancelado: "bg-destructive",
};

/** Muestra el resultado de una acción, incluido si el WhatsApp salió o no. */
export function toastResultado(r: ResultadoAccion): boolean {
  if (!r.ok) {
    toast.error(r.error);
    return false;
  }
  if (r.aviso === "enviado") {
    toast.success(r.mensaje, { description: r.avisoTexto ?? undefined });
  } else if (r.avisoTexto) {
    toast.warning(r.mensaje, { description: r.avisoTexto, duration: 8000 });
  } else {
    toast.success(r.mensaje);
  }
  return true;
}

export async function abrirComprobante(storagePath: string) {
  // Se abre la pestaña antes del await para que el navegador no la bloquee.
  const ventana = window.open("", "_blank");
  try {
    const res = await fetch("/api/inbox/media-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storagePath }),
    });
    const json = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !json.url) throw new Error(json.error ?? "Sin URL");
    if (ventana) ventana.location.href = json.url;
    else window.open(json.url, "_blank");
  } catch {
    ventana?.close();
    toast.error("No se pudo abrir el comprobante");
  }
}

/**
 * Casilla "Avisar al cliente" + el texto que se le enviará (editable).
 * Advierte si no hay chat o si la ventana de 24 h de WhatsApp está cerrada.
 */
export function CampoAviso({
  id,
  avisar,
  onAvisar,
  texto,
  onTexto,
  tieneChat,
  ventanaAbierta,
}: {
  id: string;
  avisar: boolean;
  onAvisar: (v: boolean) => void;
  texto: string;
  onTexto: (v: string) => void;
  tieneChat: boolean;
  ventanaAbierta: boolean | null;
}) {
  if (!tieneChat) {
    return (
      <p className="text-xs text-muted-foreground">
        Este pedido no tiene chat de WhatsApp: avisa al cliente por otro medio.
      </p>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-avisar`}
          checked={avisar}
          onCheckedChange={(v) => onAvisar(v === true)}
        />
        <Label htmlFor={`${id}-avisar`} className="cursor-pointer">
          Avisar al cliente por WhatsApp
        </Label>
      </div>
      {avisar && (
        <>
          <Textarea
            id={`${id}-texto`}
            aria-label="Mensaje para el cliente"
            value={texto}
            rows={5}
            maxLength={1000}
            onChange={(e) => onTexto(e.target.value)}
          />
          {ventanaAbierta === false && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle
                className="h-3.5 w-3.5 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp
              no deja enviar este texto. Quedará como nota en el chat para que
              le escribas con una plantilla.
            </p>
          )}
        </>
      )}
    </div>
  );
}
