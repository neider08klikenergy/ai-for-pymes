"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  X,
  Clock,
  Store,
  Truck,
  MapPin,
  Receipt,
  FileImage,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";
import {
  Dialog,
  DialogTitle,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ESTADO_COLOR,
  ESTADO_LABEL,
  siguienteEstado,
  type EstadoPedido,
} from "../lib/estados";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fechaCorta, horaLocal, pesos, sumarDias } from "../lib/fechas";
import type { PagoPorVerificar, PedidoFila, VistaPedidos } from "../types";
import { cambiarEstadoPedido, revisarPago } from "../services/pedidos-actions";

interface PedidosBoardProps {
  vista: VistaPedidos;
  hoy: string;
  /** false para el rol viewer: solo lectura. */
  puedeActuar: boolean;
}

const ACCION_SIGUIENTE: Partial<Record<EstadoPedido, string>> = {
  confirmado: "Pasar a producción",
  en_produccion: "Marcar listo",
  listo: "Marcar entregado",
};

const LINEA_LABEL: Record<string, string> = {
  ponque_personalizado: "Ponqué personalizado",
};

function nombreProducto(p: PedidoFila): string {
  const linea = LINEA_LABEL[p.linea] ?? p.linea.replace(/_/g, " ");
  const sabor = p.sabor && p.sabor !== "N/A" ? ` ${p.sabor}` : "";
  const cant = p.cantidad > 1 ? ` ×${p.cantidad}` : "";
  return `${linea}${sabor} · ${p.tamano}${cant}`;
}

function EstadoBadge({ estado }: { estado: EstadoPedido }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        ESTADO_COLOR[estado],
      )}
    >
      {ESTADO_LABEL[estado]}
    </span>
  );
}

// ── Filtros (fecha y sede) ───────────────────────────────────────────────────

function Filtros({ vista, hoy }: { vista: VistaPedidos; hoy: string }) {
  const router = useRouter();

  function ir(fecha: string, sede: string | null) {
    const params = new URLSearchParams();
    if (fecha !== hoy) params.set("fecha", fecha);
    if (sede) params.set("sede", sede);
    const qs = params.toString();
    router.push(qs ? `/pedidos?${qs}` : "/pedidos");
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Día anterior"
          onClick={() => ir(sumarDias(vista.fecha, -1), vista.sedeCodigo)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={vista.fecha}
          onChange={(e) =>
            e.target.value && ir(e.target.value, vista.sedeCodigo)
          }
          className="w-[150px]"
          aria-label="Fecha de entrega"
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Día siguiente"
          onClick={() => ir(sumarDias(vista.fecha, 1), vista.sedeCodigo)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {vista.fecha !== hoy && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => ir(hoy, vista.sedeCodigo)}
          >
            Hoy
          </Button>
        )}
      </div>

      {vista.sedes.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Sede">
          <Button
            size="sm"
            variant={vista.sedeCodigo === null ? "default" : "outline"}
            onClick={() => ir(vista.fecha, null)}
          >
            Todas
          </Button>
          {vista.sedes.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={vista.sedeCodigo === s.codigo ? "default" : "outline"}
              onClick={() => ir(vista.fecha, s.codigo)}
            >
              {s.nombre}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pagos por verificar ──────────────────────────────────────────────────────

async function abrirComprobante(storagePath: string) {
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

function PagoCard({
  pago,
  zona,
  puedeActuar,
  onRevisar,
}: {
  pago: PagoPorVerificar;
  zona: string;
  puedeActuar: boolean;
  onRevisar: (pago: PagoPorVerificar, aprobar: boolean) => void;
}) {
  const montoNoCoincide =
    pago.monto_reportado !== null && pago.monto_reportado < pago.monto_esperado;

  return (
    <li className="min-w-0 rounded-xl border border-warning/30 bg-warning/5 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">
            {pago.pedido?.numero ?? "Pedido"}{" "}
            <span className="font-sans font-normal text-muted-foreground">
              · {pago.tipo}
            </span>
          </p>
          <p className="text-sm truncate">{pago.pedido?.nombre_cliente}</p>
          {pago.pedido && (
            <p className="text-xs text-muted-foreground">
              Entrega {fechaCorta(pago.pedido.fecha_entrega, zona)}{" "}
              {horaLocal(pago.pedido.fecha_entrega, zona)}
              {pago.pedido.sede_nombre ? ` · ${pago.pedido.sede_nombre}` : ""}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">Esperado</p>
          <p className="font-display text-lg font-semibold tabular-nums">
            {pesos(pago.monto_esperado)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Monto del comprobante</dt>
        <dd
          className={cn(
            "tabular-nums",
            montoNoCoincide && "text-destructive font-semibold",
          )}
        >
          {pago.monto_reportado !== null ? pesos(pago.monto_reportado) : "—"}
        </dd>
        <dt className="text-muted-foreground">Banco</dt>
        <dd>{pago.banco ?? "—"}</dd>
        <dt className="text-muted-foreground">Referencia</dt>
        <dd className="font-mono break-all">{pago.referencia ?? "—"}</dd>
        <dt className="text-muted-foreground">Fecha del pago</dt>
        <dd>{pago.fecha_pago ?? "—"}</dd>
      </dl>

      {montoNoCoincide && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          El monto es menor que el anticipo esperado.
        </p>
      )}

      {pago.descripcion_ia && (
        <p
          className="text-xs text-muted-foreground line-clamp-3"
          title={pago.descripcion_ia}
        >
          <span className="font-medium">Lo que leyó la IA:</span>{" "}
          {pago.descripcion_ia}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {pago.storage_path ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => abrirComprobante(pago.storage_path!)}
          >
            <FileImage className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Ver comprobante
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Sin archivo adjunto
          </span>
        )}
        {pago.pedido?.conversation_id && (
          <Link href={`/inbox/${pago.pedido.conversation_id}`}>
            <Button variant="ghost" size="sm">
              <MessageCircle className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Chat
            </Button>
          </Link>
        )}
        {puedeActuar && (
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRevisar(pago, false)}
            >
              Rechazar
            </Button>
            <Button size="sm" onClick={() => onRevisar(pago, true)}>
              Confirmar
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function RevisionDialog({
  revision,
  onClose,
}: {
  revision: { pago: PagoPorVerificar; aprobar: boolean };
  onClose: () => void;
}) {
  const { pago, aprobar } = revision;
  // El padre monta el diálogo con una key por pago, así el formulario arranca limpio.
  const [monto, setMonto] = useState(() =>
    String(pago.monto_reportado ?? pago.monto_esperado),
  );
  const [motivo, setMotivo] = useState("");
  const [pendiente, startTransition] = useTransition();

  function enviar() {
    const montoNum = Number(monto.replace(/[^\d]/g, ""));
    if (aprobar && (!Number.isFinite(montoNum) || montoNum <= 0)) {
      toast.error("Escribe el monto recibido");
      return;
    }
    startTransition(async () => {
      const r = await revisarPago({
        pagoId: pago.id,
        aprobar,
        monto: aprobar ? montoNum : null,
        motivo: aprobar ? null : motivo,
      });
      if (r.ok) {
        toast.success(r.mensaje);
        onClose();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendiente && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {aprobar ? "Confirmar pago" : "Rechazar pago"} ·{" "}
            {pago.pedido?.numero}
          </DialogTitle>
          <DialogDescription>
            {aprobar
              ? "Confírmalo solo si ya viste el dinero en la cuenta. El pedido queda agendado."
              : "El pedido vuelve a 'Sin anticipo'. Después escríbele al cliente por el chat."}
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

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pendiente}>
            Cancelar
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

// ── Pedidos del día ──────────────────────────────────────────────────────────

function PedidoCard({
  pedido,
  zona,
  puedeActuar,
  mostrarSede,
  onCancelar,
}: {
  pedido: PedidoFila;
  zona: string;
  puedeActuar: boolean;
  mostrarSede: boolean;
  onCancelar: (p: PedidoFila) => void;
}) {
  const [pendiente, startTransition] = useTransition();
  const siguiente = siguienteEstado(pedido.estado);
  const d = pedido.detalle;
  const inactivo =
    pedido.estado === "cancelado" || pedido.estado === "entregado";

  function avanzar() {
    if (!siguiente) return;
    startTransition(async () => {
      const r = await cambiarEstadoPedido(pedido.id, siguiente);
      if (r.ok) toast.success(r.mensaje);
      else toast.error(r.error);
    });
  }

  return (
    <li
      className={cn(
        "min-w-0 rounded-xl border border-border/50 bg-card p-4 flex flex-col gap-3",
        inactivo && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 rounded-lg bg-muted px-2.5 py-1.5 text-center">
            <p className="font-display text-sm font-semibold tabular-nums leading-tight">
              {horaLocal(pedido.fecha_entrega, zona)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold">{pedido.numero}</p>
            <p className="text-sm font-medium line-clamp-2">
              {nombreProducto(pedido)}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {pedido.nombre_cliente}
              {pedido.telefono ? ` · ${pedido.telefono}` : ""}
            </p>
          </div>
        </div>
        <EstadoBadge estado={pedido.estado} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {mostrarSede && pedido.sede && (
          <span className="flex items-center gap-1">
            <Store className="h-3.5 w-3.5" aria-hidden="true" />
            {pedido.sede.nombre}
          </span>
        )}
        {pedido.modalidad === "domicilio" ? (
          <span className="flex items-center gap-1">
            <Truck className="h-3.5 w-3.5" aria-hidden="true" />
            Domicilio
            {pedido.direccion_entrega ? `: ${pedido.direccion_entrega}` : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Recoge en sede
          </span>
        )}
      </div>

      {(d.decoracion || d.mensaje || d.forma || d.notas || pedido.notas) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs rounded-lg bg-muted/50 p-2.5">
          {d.decoracion && (
            <>
              <dt className="text-muted-foreground">Decoración</dt>
              <dd>{d.decoracion}</dd>
            </>
          )}
          {d.mensaje && (
            <>
              <dt className="text-muted-foreground">Mensaje</dt>
              <dd>“{d.mensaje}”</dd>
            </>
          )}
          {d.forma && (
            <>
              <dt className="text-muted-foreground">Forma</dt>
              <dd>{d.forma}</dd>
            </>
          )}
          {(d.notas || pedido.notas) && (
            <>
              <dt className="text-muted-foreground">Notas</dt>
              <dd>{[d.notas, pedido.notas].filter(Boolean).join(" · ")}</dd>
            </>
          )}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          Total <strong className="tabular-nums">{pesos(pedido.total)}</strong>
        </span>
        <span>
          Pagado{" "}
          <strong className="tabular-nums">{pesos(pedido.pagado)}</strong>
        </span>
        <span className={cn(pedido.saldo > 0 && "text-warning font-medium")}>
          Saldo <strong className="tabular-nums">{pesos(pedido.saldo)}</strong>
        </span>
        {!pedido.precio_validado && (
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Precio sin validar
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pedido.conversation_id && (
          <Link href={`/inbox/${pedido.conversation_id}`}>
            <Button variant="ghost" size="sm">
              <MessageCircle className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Chat
            </Button>
          </Link>
        )}
        {puedeActuar && !inactivo && (
          <div className="flex gap-2 ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onCancelar(pedido)}
              disabled={pendiente}
            >
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              Cancelar
            </Button>
            {siguiente && (
              <Button size="sm" onClick={avanzar} disabled={pendiente}>
                {pendiente ? "Guardando…" : ACCION_SIGUIENTE[pedido.estado]}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function CancelarDialog({
  pedido,
  onClose,
}: {
  pedido: PedidoFila | null;
  onClose: () => void;
}) {
  const [pendiente, startTransition] = useTransition();
  if (!pedido) return null;

  function cancelar() {
    if (!pedido) return;
    startTransition(async () => {
      const r = await cambiarEstadoPedido(pedido.id, "cancelado");
      if (r.ok) {
        toast.success(r.mensaje);
        onClose();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pendiente && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar {pedido.numero}</DialogTitle>
          <DialogDescription>
            {pedido.pagado > 0
              ? `El cliente ya pagó ${pesos(pedido.pagado)}. Según la política queda como saldo a favor por 6 meses; regístralo y avísale por el chat.`
              : "El pedido no tiene pagos confirmados."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pendiente}>
            Volver
          </Button>
          <Button variant="destructive" onClick={cancelar} disabled={pendiente}>
            {pendiente ? "Cancelando…" : "Cancelar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export function PedidosBoard({ vista, hoy, puedeActuar }: PedidosBoardProps) {
  const [revision, setRevision] = useState<{
    pago: PagoPorVerificar;
    aprobar: boolean;
  } | null>(null);
  const [aCancelar, setACancelar] = useState<PedidoFila | null>(null);

  const conteo = useMemo(() => {
    const c: Partial<Record<EstadoPedido, number>> = {};
    for (const p of vista.pedidos) c[p.estado] = (c[p.estado] ?? 0) + 1;
    return c;
  }, [vista.pedidos]);

  const activos = vista.pedidos.filter((p) => p.estado !== "cancelado");
  const cancelados = vista.pedidos.filter((p) => p.estado === "cancelado");
  const tituloDia =
    vista.fecha === hoy
      ? "Entregas de hoy"
      : `Entregas del ${fechaCorta(`${vista.fecha}T12:00:00Z`, "UTC")}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Receipt className="h-5 w-5 text-primary" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold">Pedidos</h1>
      </div>

      {vista.sedes.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Este workspace todavía no tiene sedes. Carga el seed del negocio para
          usar pedidos.
        </p>
      )}

      {vista.pagos.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="pagos-titulo">
          <h2
            id="pagos-titulo"
            className="text-sm font-semibold flex items-center gap-2"
          >
            Pagos por verificar
            <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs tabular-nums">
              {vista.pagos.length}
            </span>
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {vista.pagos.map((pago) => (
              <PagoCard
                key={pago.id}
                pago={pago}
                zona={vista.zona}
                puedeActuar={puedeActuar}
                onRevisar={(p, aprobar) => setRevision({ pago: p, aprobar })}
              />
            ))}
          </ul>
        </section>
      )}

      <section
        className="flex flex-col gap-3"
        aria-labelledby="entregas-titulo"
      >
        <div className="flex flex-col gap-3">
          <h2
            id="entregas-titulo"
            className="text-sm font-semibold flex items-center gap-2"
          >
            <CalendarDays
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            {tituloDia}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({activos.length})
            </span>
          </h2>
          <Filtros vista={vista} hoy={hoy} />
          {activos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(conteo) as EstadoPedido[])
                .filter((e) => e !== "cancelado")
                .map((e) => (
                  <span key={e} className="text-xs text-muted-foreground">
                    <EstadoBadge estado={e} /> {conteo[e]}
                  </span>
                ))}
            </div>
          )}
        </div>

        {activos.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No hay entregas para este día.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {activos.map((p) => (
              <PedidoCard
                key={p.id}
                pedido={p}
                zona={vista.zona}
                puedeActuar={puedeActuar}
                mostrarSede={vista.sedeCodigo === null}
                onCancelar={setACancelar}
              />
            ))}
          </ul>
        )}

        {cancelados.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Cancelados ({cancelados.length})
            </summary>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 mt-3">
              {cancelados.map((p) => (
                <PedidoCard
                  key={p.id}
                  pedido={p}
                  zona={vista.zona}
                  puedeActuar={false}
                  mostrarSede={vista.sedeCodigo === null}
                  onCancelar={setACancelar}
                />
              ))}
            </ul>
          </details>
        )}
      </section>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden="true" />
        Horas en {vista.zona}.
      </p>

      {revision && (
        <RevisionDialog
          key={`${revision.pago.id}:${revision.aprobar}`}
          revision={revision}
          onClose={() => setRevision(null)}
        />
      )}
      <CancelarDialog pedido={aCancelar} onClose={() => setACancelar(null)} />
    </div>
  );
}
