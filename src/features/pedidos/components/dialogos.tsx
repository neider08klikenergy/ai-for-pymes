"use client";

import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  type DatosAviso,
  mensajePedidoListo,
  mensajePagoRechazado,
  mensajePagoConfirmado,
  mensajePedidoCancelado,
} from "../lib/mensajes";
import { pesos } from "../lib/fechas";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { Textarea } from "@/components/ui/textarea";
import { CampoAviso, toastResultado } from "./comun";
import type { PagoPorVerificar, PedidoFila } from "../types";
import { cambiarEstadoPedido, revisarPago } from "../services/pedidos-actions";

// ── Confirmar / rechazar comprobante ─────────────────────────────────────────

export interface RevisionPendiente {
  pago: PagoPorVerificar;
  aprobar: boolean;
}

/** El padre lo monta con key por pago, así el formulario arranca limpio. */
export function RevisionDialog({
  revision,
  zona,
  onClose,
}: {
  revision: RevisionPendiente;
  zona: string;
  onClose: () => void;
}) {
  const { pago, aprobar } = revision;
  const ped = pago.pedido;
  const datos: DatosAviso | null = ped
    ? {
        numero: ped.numero,
        nombre_cliente: ped.nombre_cliente,
        fecha_entrega: ped.fecha_entrega,
        sede_nombre: ped.sede_nombre,
        modalidad: ped.modalidad,
        total: ped.total,
        pagado: ped.pagado,
      }
    : null;

  const [monto, setMonto] = useState(() =>
    String(pago.monto_reportado ?? pago.monto_esperado),
  );
  const [motivo, setMotivo] = useState("");
  const [avisar, setAvisar] = useState(true);
  // null = el texto sigue la propuesta automática; string = la persona lo editó.
  const [textoEditado, setTextoEditado] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const montoNum = Number(monto.replace(/[^\d]/g, ""));
  const propuesta = datos
    ? aprobar
      ? mensajePagoConfirmado(
          datos,
          Number.isFinite(montoNum) ? montoNum : 0,
          zona,
        )
      : mensajePagoRechazado(datos, motivo)
    : "";
  const texto = textoEditado ?? propuesta;

  function enviar() {
    if (aprobar && (!Number.isFinite(montoNum) || montoNum <= 0)) {
      return void toastResultado({
        ok: false,
        error: "Escribe el monto recibido",
      });
    }
    if (!aprobar && !motivo.trim()) {
      return void toastResultado({
        ok: false,
        error: "Escribe el motivo del rechazo",
      });
    }
    startTransition(async () => {
      const r = await revisarPago({
        pagoId: pago.id,
        aprobar,
        monto: aprobar ? montoNum : null,
        motivo: aprobar ? null : motivo,
        aviso: avisar ? texto : null,
      });
      if (toastResultado(r)) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendiente && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {aprobar ? "Confirmar pago" : "Rechazar pago"} · {ped?.numero}
          </DialogTitle>
          <DialogDescription>
            {aprobar
              ? "Confírmalo solo si ya viste el dinero en la cuenta. El pedido queda agendado."
              : "El pedido vuelve a 'Sin anticipo' hasta que el cliente envíe un pago válido."}
          </DialogDescription>
        </DialogHeader>

        {aprobar ? (
          <div className="grid gap-2">
            <Label htmlFor="monto-recibido">Monto recibido (COP)</Label>
            <Input
              id="monto-recibido"
              inputMode="numeric"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Esperado: {pesos(pago.monto_esperado)}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="motivo-rechazo">Motivo</Label>
            <Textarea
              id="motivo-rechazo"
              placeholder="Ej: la transferencia no aparece en la cuenta"
              value={motivo}
              maxLength={300}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        )}

        <CampoAviso
          id="aviso-pago"
          avisar={avisar}
          onAvisar={setAvisar}
          texto={texto}
          onTexto={setTextoEditado}
          tieneChat={!!ped?.conversation_id}
          ventanaAbierta={ped?.ventana_abierta ?? null}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pendiente}>
            Volver
          </Button>
          <Button
            variant={aprobar ? "default" : "destructive"}
            onClick={enviar}
            disabled={pendiente}
          >
            {pendiente
              ? "Guardando…"
              : aprobar
                ? "Confirmar pago"
                : "Rechazar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Marcar listo / cancelar (con aviso al cliente) ───────────────────────────

export interface CambioPendiente {
  pedido: PedidoFila;
  hacia: "listo" | "cancelado";
}

export function CambioEstadoDialog({
  cambio,
  onClose,
}: {
  cambio: CambioPendiente;
  onClose: () => void;
}) {
  const { pedido, hacia } = cambio;
  const datos: DatosAviso = {
    numero: pedido.numero,
    nombre_cliente: pedido.nombre_cliente,
    fecha_entrega: pedido.fecha_entrega,
    sede_nombre: pedido.sede?.nombre ?? null,
    modalidad: pedido.modalidad,
    total: pedido.total,
    pagado: pedido.pagado,
  };
  const cancelar = hacia === "cancelado";
  const [avisar, setAvisar] = useState(true);
  const [texto, setTexto] = useState(() =>
    cancelar ? mensajePedidoCancelado(datos) : mensajePedidoListo(datos),
  );
  const [pendiente, startTransition] = useTransition();

  function enviar() {
    startTransition(async () => {
      const r = await cambiarEstadoPedido({
        pedidoId: pedido.id,
        hacia,
        aviso: avisar ? texto : null,
      });
      if (toastResultado(r)) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendiente && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {cancelar ? "Cancelar" : "Marcar listo"} · {pedido.numero}
          </DialogTitle>
          <DialogDescription>
            {cancelar
              ? pedido.pagado > 0
                ? `El cliente ya pagó ${pesos(pedido.pagado)}. Según la política queda como saldo a favor por 6 meses. El cupo del día se libera.`
                : "El pedido no tiene pagos confirmados. El cupo del día se libera."
              : "El pedido pasa a 'Listo' para entregar."}
          </DialogDescription>
        </DialogHeader>

        <CampoAviso
          id="aviso-estado"
          avisar={avisar}
          onAvisar={setAvisar}
          texto={texto}
          onTexto={setTexto}
          tieneChat={!!pedido.conversation_id}
          ventanaAbierta={pedido.ventana_abierta}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pendiente}>
            Volver
          </Button>
          <Button
            variant={cancelar ? "destructive" : "default"}
            onClick={enviar}
            disabled={pendiente}
          >
            {pendiente
              ? "Guardando…"
              : cancelar
                ? "Cancelar pedido"
                : "Marcar listo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
