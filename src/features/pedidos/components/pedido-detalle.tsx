"use client";

import {
  Sheet,
  SheetTitle,
  SheetHeader,
  SheetContent,
  SheetDescription,
} from "@/components/ui/sheet";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { siguienteEstado } from "../lib/estados";
import { fechaCorta, horaLocal, pesos } from "../lib/fechas";
import { AlertTriangle, MessageCircle, Wallet, X } from "lucide-react";

function fechaLarga(iso: string, zona: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: zona,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}
import type { PedidoFila } from "../types";
import { ACCION_SIGUIENTE, EstadoBadge, nombreProducto } from "./comun";

const PAGO_ESTADO: Record<string, { label: string; className: string }> = {
  por_verificar: { label: "Por verificar", className: "text-warning" },
  confirmado: { label: "Confirmado", className: "text-success" },
  rechazado: { label: "Rechazado", className: "text-destructive" },
};

function Fila({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export function PedidoDetalle({
  pedido,
  zona,
  puedeActuar,
  ocupado,
  onClose,
  onAvanzar,
  onCancelar,
  onAplicarSaldo,
}: {
  pedido: PedidoFila | null;
  zona: string;
  puedeActuar: boolean;
  ocupado: boolean;
  onClose: () => void;
  onAvanzar: (p: PedidoFila) => void;
  onCancelar: (p: PedidoFila) => void;
  onAplicarSaldo: (p: PedidoFila) => void;
}) {
  const siguiente = pedido ? siguienteEstado(pedido.estado) : null;
  const activo =
    pedido && pedido.estado !== "entregado" && pedido.estado !== "cancelado";
  const d = pedido?.detalle ?? {};

  return (
    <Sheet open={!!pedido} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-md">
        {pedido && (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2">
                <SheetTitle className="font-mono">{pedido.numero}</SheetTitle>
                <EstadoBadge estado={pedido.estado} />
              </div>
              <SheetDescription>
                Entrega {fechaCorta(pedido.fecha_entrega, zona)} ·{" "}
                {horaLocal(pedido.fecha_entrega, zona)}
              </SheetDescription>
            </SheetHeader>

            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pedido
              </h3>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Fila label="Producto">{nombreProducto(pedido)}</Fila>
                <Fila label="Sede">{pedido.sede?.nombre ?? "—"}</Fila>
                <Fila label="Entrega">
                  {pedido.modalidad === "domicilio"
                    ? `Domicilio: ${pedido.direccion_entrega ?? "sin dirección"}`
                    : "Recoge en sede"}
                </Fila>
                {d.decoracion && <Fila label="Decoración">{d.decoracion}</Fila>}
                {d.mensaje && <Fila label="Mensaje">“{d.mensaje}”</Fila>}
                {d.forma && <Fila label="Forma">{d.forma}</Fila>}
                {(d.notas || pedido.notas) && (
                  <Fila label="Notas">
                    {[d.notas, pedido.notas].filter(Boolean).join(" · ")}
                  </Fila>
                )}
              </dl>
            </section>

            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cliente
              </h3>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Fila label="Nombre">{pedido.nombre_cliente}</Fila>
                <Fila label="Teléfono">{pedido.telefono ?? "—"}</Fila>
              </dl>
              {pedido.conversation_id && (
                <Link
                  href={`/inbox/${pedido.conversation_id}`}
                  className="w-fit"
                >
                  <Button variant="outline" size="sm">
                    <MessageCircle
                      className="h-4 w-4 mr-1.5"
                      aria-hidden="true"
                    />
                    Abrir chat
                  </Button>
                </Link>
              )}
            </section>

            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pagos
              </h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Total", pedido.total, ""],
                  ["Pagado", pedido.pagado, "text-success"],
                  [
                    "Saldo",
                    pedido.saldo,
                    pedido.saldo > 0 ? "text-warning" : "",
                  ],
                ].map(([label, valor, color]) => (
                  <div
                    key={label as string}
                    className="rounded-lg bg-muted/50 p-2"
                  >
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        color as string,
                      )}
                    >
                      {pesos(valor as number)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Anticipo requerido: {pesos(pedido.anticipo_requerido)}
              </p>
              {!pedido.precio_validado && (
                <p className="flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Precio del tarifario sin validar por el negocio
                </p>
              )}
              {pedido.pagos.length > 0 ? (
                <ul className="grid gap-1.5 text-xs">
                  {pedido.pagos.map((pg) => (
                    <li
                      key={pg.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 rounded-md border border-border/50 px-2.5 py-1.5"
                    >
                      <span>
                        {fechaCorta(pg.created_at, zona)} ·{" "}
                        {pg.tipo === "saldo_favor" ? "saldo a favor" : pg.tipo}
                        {pg.referencia ? ` · ref ${pg.referencia}` : ""}
                      </span>
                      <span className="tabular-nums">
                        {pesos(pg.monto_reportado ?? pg.monto_esperado)}{" "}
                        <span className={PAGO_ESTADO[pg.estado]?.className}>
                          {PAGO_ESTADO[pg.estado]?.label ?? pg.estado}
                        </span>
                      </span>
                      {pg.motivo_rechazo && (
                        <span className="w-full text-muted-foreground">
                          Motivo: {pg.motivo_rechazo}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sin comprobantes todavía.
                </p>
              )}

              {pedido.saldo_favor_generado && (
                <div className="rounded-lg border border-info/30 bg-info/5 p-2.5 text-xs">
                  <p className="font-medium text-info">
                    <Wallet
                      className="mr-1 inline h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    Dejó saldo a favor de{" "}
                    {pesos(pedido.saldo_favor_generado.monto_inicial)}
                  </p>
                  <p className="text-muted-foreground">
                    Disponible{" "}
                    {pesos(pedido.saldo_favor_generado.monto_disponible)} ·
                    vence{" "}
                    {fechaLarga(pedido.saldo_favor_generado.vence_at, zona)}
                  </p>
                </div>
              )}

              {activo && pedido.saldo > 0 && pedido.saldo_favor_cliente > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/5 p-2.5 text-xs">
                  <span>
                    <Wallet
                      className="mr-1 inline h-3.5 w-3.5 text-success"
                      aria-hidden="true"
                    />
                    El cliente tiene {pesos(pedido.saldo_favor_cliente)} de
                    saldo a favor
                  </span>
                  {puedeActuar && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={ocupado}
                      onClick={() => onAplicarSaldo(pedido)}
                    >
                      Usar{" "}
                      {pesos(
                        Math.min(pedido.saldo, pedido.saldo_favor_cliente),
                      )}
                    </Button>
                  )}
                </div>
              )}
            </section>

            {puedeActuar && activo && (
              <div className="mt-auto flex flex-wrap gap-2 border-t border-border/50 pt-4">
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onCancelar(pedido)}
                  disabled={ocupado}
                >
                  <X className="h-4 w-4 mr-1" aria-hidden="true" />
                  Cancelar pedido
                </Button>
                {siguiente && (
                  <Button
                    className="ml-auto"
                    onClick={() => onAvanzar(pedido)}
                    disabled={ocupado}
                  >
                    {ocupado ? "Guardando…" : ACCION_SIGUIENTE[pedido.estado]}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
