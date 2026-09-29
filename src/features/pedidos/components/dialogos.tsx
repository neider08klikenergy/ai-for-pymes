"use client";

import {
  Dialog,
  DialogTitle,
  DialogFooter,
  DialogHeader,
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
import {
  revisarPago,
  cancelarPedido,
  cambiarEstadoPedido,
} from "../services/pedidos-actions";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CampoAviso, toastResultado } from "./comun";
import type { PagoPorVerificar, PedidoFila } from "../types";
import { diasEntre, fechaLocalDe, hoyEnZona, pesos } from "../lib/fechas";

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

// ── Marcar listo (con aviso al cliente) ──────────────────────────────────────

export interface CambioPendiente {
  pedido: PedidoFila;
  hacia: "listo" | "cancelado";
}

function datosDe(pedido: PedidoFila): DatosAviso {
  return {
    numero: pedido.numero,
    nombre_cliente: pedido.nombre_cliente,
    fecha_entrega: pedido.fecha_entrega,
    sede_nombre: pedido.sede?.nombre ?? null,
    modalidad: pedido.modalidad,
    total: pedido.total,
    pagado: pedido.pagado,
  };
}

export function ListoDialog({
  pedido,
  onClose,
}: {
  pedido: PedidoFila;
  onClose: () => void;
}) {
  const [avisar, setAvisar] = useState(true);
  const [texto, setTexto] = useState(() => mensajePedidoListo(datosDe(pedido)));
  const [pendiente, startTransition] = useTransition();

  function enviar() {
    startTransition(async () => {
      const r = await cambiarEstadoPedido({
        pedidoId: pedido.id,
        hacia: "listo",
        aviso: avisar ? texto : null,
      });
      if (toastResultado(r)) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendiente && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marcar listo · {pedido.numero}</DialogTitle>
          <DialogDescription>
            El pedido pasa a &quot;Listo&quot; para entregar.
          </DialogDescription>
        </DialogHeader>
        <CampoAviso
          id="aviso-listo"
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
          <Button onClick={enviar} disabled={pendiente}>
            {pendiente ? "Guardando…" : "Marcar listo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Cancelar (con saldo a favor y aviso) ─────────────────────────────────────

export function CancelarDialog({
  pedido,
  zona,
  reglas,
  onClose,
}: {
  pedido: PedidoFila;
  zona: string;
  reglas: { cancelacionDias: number; saldoFavorMeses: number };
  onClose: () => void;
}) {
  const diasAntes = diasEntre(
    hoyEnZona(zona),
    fechaLocalDe(pedido.fecha_entrega, zona),
  );
  const aTiempo = diasAntes >= reglas.cancelacionDias;
  const tienePago = pedido.pagado > 0;

  const [generarSaldo, setGenerarSaldo] = useState(tienePago && aTiempo);
  const [motivo, setMotivo] = useState("");
  const [avisar, setAvisar] = useState(true);
  const [textoEditado, setTextoEditado] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const texto =
    textoEditado ??
    mensajePedidoCancelado(datosDe(pedido), {
      generar: generarSaldo,
      meses: reglas.saldoFavorMeses,
    });

  function enviar() {
    startTransition(async () => {
      const r = await cancelarPedido({
        pedidoId: pedido.id,
        generarSaldo: tienePago && generarSaldo,
        motivo,
        aviso: avisar ? texto : null,
      });
      if (toastResultado(r)) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendiente && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cancelar · {pedido.numero}</DialogTitle>
          <DialogDescription>
            Entrega en {diasAntes} {diasAntes === 1 ? "día" : "días"}. El cupo
            del día se libera.
          </DialogDescription>
        </DialogHeader>

        {!aTiempo && (
          <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 p-2.5 text-xs text-warning">
            <AlertTriangle
              className="h-3.5 w-3.5 mt-0.5 shrink-0"
              aria-hidden="true"
            />
            Fuera de plazo: la política pide cancelar con{" "}
            {reglas.cancelacionDias} días calendario de anticipación. Decide con
            el negocio si igual se deja saldo a favor.
          </p>
        )}

        {tienePago ? (
          <div className="flex items-start gap-2 rounded-lg border border-border/60 p-3">
            <Checkbox
              id="generar-saldo"
              checked={generarSaldo}
              onCheckedChange={(v) => {
                setGenerarSaldo(v === true);
                setTextoEditado(null);
              }}
            />
            <Label
              htmlFor="generar-saldo"
              className="cursor-pointer leading-snug"
            >
              Dejar {pesos(pedido.pagado)} como saldo a favor del cliente
              <span className="block text-xs font-normal text-muted-foreground">
                Vigente {reglas.saldoFavorMeses} meses. No hay devolución en
                efectivo.
              </span>
            </Label>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            El pedido no tiene pagos confirmados.
          </p>
        )}

        <div className="grid gap-2">
          <Label htmlFor="motivo-cancelacion">Motivo (opcional)</Label>
          <Input
            id="motivo-cancelacion"
            value={motivo}
            maxLength={300}
            placeholder="Ej: el cliente cambió la fecha del evento"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        <CampoAviso
          id="aviso-cancelar"
          avisar={avisar}
          onAvisar={setAvisar}
          texto={texto}
          onTexto={setTextoEditado}
          tieneChat={!!pedido.conversation_id}
          ventanaAbierta={pedido.ventana_abierta}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pendiente}>
            Volver
          </Button>
          <Button variant="destructive" onClick={enviar} disabled={pendiente}>
            {pendiente ? "Cancelando…" : "Cancelar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
