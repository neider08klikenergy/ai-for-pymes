"use client";

import {
  Sheet,
  SheetTitle,
  SheetHeader,
  SheetContent,
  SheetDescription,
} from "@/components/ui/sheet";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fijarDomicilio } from "../services/pedidos-actions";
import { siguienteEstado } from "../lib/estados";
import { useLocale, useTranslations } from "next-intl";
import { fechaCorta, horaLocal, pesos } from "../lib/fechas";
import { AlertTriangle, MessageCircle, Wallet, X } from "lucide-react";

function fechaLarga(iso: string, zona: string, idioma: string): string {
  return new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "es-CO", {
    timeZone: zona,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}
import type { PedidoFila } from "../types";
import { EstadoBadge, nombreProducto, useAccionSiguiente } from "./comun";

// label: clave de pedidos.detalle.estadoPago.*
const PAGO_ESTADO: Record<string, { label: string; className: string }> = {
  por_verificar: { label: "por_verificar", className: "text-warning" },
  confirmado: { label: "confirmado", className: "text-success" },
  rechazado: { label: "rechazado", className: "text-destructive" },
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

/**
 * Valor del domicilio. Sin tarifa llega "por definir" y el equipo lo fija
 * aquí (hasta entonces no se puede confirmar el pago); también se corrige.
 */
function ValorDomicilio({
  pedido,
  puedeEditar,
}: {
  pedido: PedidoFila;
  puedeEditar: boolean;
}) {
  const t = useTranslations("pedidos.detalle");
  const ta = useTranslations("pedidos.acciones");
  const router = useRouter();
  const porDefinir = pedido.domicilio_origen === "pendiente";
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [guardando, startTransition] = useTransition();

  function guardar() {
    const n = Number(valor);
    if (valor.trim() === "" || !Number.isInteger(n) || n < 0) {
      toast.error(ta("rpc.VALOR_NO_VALIDO"));
      return;
    }
    startTransition(async () => {
      const r = await fijarDomicilio({ pedidoId: pedido.id, valor: n });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.mensaje);
      setEditando(false);
      setValor("");
      router.refresh();
    });
  }

  if (puedeEditar && (porDefinir || editando)) {
    return (
      <div className="grid gap-1.5">
        {porDefinir && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t("porDefinirAviso")}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={t("valorDomicilio")}
            aria-label={t("valorDomicilio")}
            className="h-8 w-32"
            disabled={guardando}
          />
          <Button size="sm" onClick={guardar} disabled={guardando}>
            {t("guardarDomicilio")}
          </Button>
        </div>
      </div>
    );
  }

  if (porDefinir) {
    return <span className="font-medium text-warning">{t("porDefinir")}</span>;
  }

  return (
    <>
      {pesos(pedido.valor_domicilio)}
      <span className="text-xs text-muted-foreground">
        {pedido.domicilio_origen === "persona"
          ? ` · ${t("valorEquipo")}`
          : pedido.domicilio_origen === "tarifa"
            ? ` · ${t("segunTarifa")}`
            : ""}
      </span>
      {puedeEditar && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="ml-2 text-xs text-primary underline-offset-2 hover:underline"
        >
          {t("corregirDomicilio")}
        </button>
      )}
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
  const t = useTranslations("pedidos.detalle");
  const tp = useTranslations("pedidos.pagos");
  const idioma = useLocale();
  const accionSiguiente = useAccionSiguiente();

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
                {t("entrega")} {fechaCorta(pedido.fecha_entrega, zona, idioma)}{" "}
                · {horaLocal(pedido.fecha_entrega, zona, idioma)}
              </SheetDescription>
            </SheetHeader>

            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pedido")}
              </h3>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Fila label={t("producto")}>{nombreProducto(pedido)}</Fila>
                <Fila label={t("sede")}>{pedido.sede?.nombre ?? "—"}</Fila>
                <Fila label={t("entrega")}>
                  {pedido.modalidad === "domicilio"
                    ? t("domicilioEn", {
                        direccion:
                          pedido.direccion_entrega ?? t("sinDireccion"),
                      })
                    : t("recogeEnSede")}
                </Fila>
                {pedido.modalidad === "domicilio" && (
                  <Fila label={t("domicilio")}>
                    <ValorDomicilio
                      pedido={pedido}
                      puedeEditar={puedeActuar && !!activo}
                    />
                  </Fila>
                )}
                {d.decoracion && (
                  <Fila label={t("decoracion")}>{d.decoracion}</Fila>
                )}
                {d.mensaje && <Fila label={t("mensaje")}>“{d.mensaje}”</Fila>}
                {d.forma && <Fila label={t("forma")}>{d.forma}</Fila>}
                {(d.notas || pedido.notas) && (
                  <Fila label={t("notas")}>
                    {[d.notas, pedido.notas].filter(Boolean).join(" · ")}
                  </Fila>
                )}
              </dl>
            </section>

            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("cliente")}
              </h3>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Fila label={t("nombre")}>{pedido.nombre_cliente}</Fila>
                <Fila label={t("telefono")}>{pedido.telefono ?? "—"}</Fila>
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
                    {t("abrirChat")}
                  </Button>
                </Link>
              )}
            </section>

            <section className="grid gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("pagos")}
              </h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  [t("total"), pedido.total, ""],
                  [t("pagado"), pedido.pagado, "text-success"],
                  [
                    t("saldo"),
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
                {t("anticipoMinimo", {
                  monto: pesos(pedido.anticipo_requerido),
                })}
                {pedido.valor_domicilio > 0 &&
                  ` · ${t("productoMasDomicilio", {
                    producto: pesos(pedido.total - pedido.valor_domicilio),
                    domicilio: pesos(pedido.valor_domicilio),
                  })}`}
              </p>
              {!pedido.precio_validado && (
                <p className="flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("precioSinValidar")}
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
                        {fechaCorta(pg.created_at, zona, idioma)} ·{" "}
                        {tp.has(`tipo.${pg.tipo}`)
                          ? tp(`tipo.${pg.tipo}` as "tipo.anticipo")
                          : pg.tipo}
                        {pg.referencia ? ` · ${t("ref")} ${pg.referencia}` : ""}
                      </span>
                      <span className="tabular-nums">
                        {pesos(pg.monto_reportado ?? pg.monto_esperado)}{" "}
                        <span className={PAGO_ESTADO[pg.estado]?.className}>
                          {PAGO_ESTADO[pg.estado]
                            ? t(
                                `estadoPago.${PAGO_ESTADO[pg.estado].label}` as "estadoPago.confirmado",
                              )
                            : pg.estado}
                        </span>
                      </span>
                      {pg.motivo_rechazo && (
                        <span className="w-full text-muted-foreground">
                          {t("motivo")}: {pg.motivo_rechazo}
                        </span>
                      )}
                      {pg.nota_revision && (
                        <span className="w-full text-muted-foreground">
                          {t("diferenciaConfirmada", {
                            comprobante: pesos(pg.monto_comprobante ?? pg.monto_esperado),
                            nota: pg.nota_revision,
                          })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("sinComprobantes")}
                </p>
              )}

              {pedido.saldo_favor_generado && (
                <div className="rounded-lg border border-info/30 bg-info/5 p-2.5 text-xs">
                  <p className="font-medium text-info">
                    <Wallet
                      className="mr-1 inline h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    {t("dejoSaldo", {
                      monto: pesos(pedido.saldo_favor_generado.monto_inicial),
                    })}
                  </p>
                  <p className="text-muted-foreground">
                    {t("disponibleVence", {
                      monto: pesos(
                        pedido.saldo_favor_generado.monto_disponible,
                      ),
                      fecha: fechaLarga(
                        pedido.saldo_favor_generado.vence_at,
                        zona,
                        idioma,
                      ),
                    })}
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
                    {t("clienteTieneSaldo", {
                      monto: pesos(pedido.saldo_favor_cliente),
                    })}
                  </span>
                  {puedeActuar && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={ocupado}
                      onClick={() => onAplicarSaldo(pedido)}
                    >
                      {t("usar", {
                        monto: pesos(
                          Math.min(pedido.saldo, pedido.saldo_favor_cliente),
                        ),
                      })}
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
                  {t("cancelarPedido")}
                </Button>
                {siguiente && (
                  <Button
                    className="ml-auto"
                    onClick={() => onAvanzar(pedido)}
                    disabled={ocupado}
                  >
                    {ocupado ? t("guardando") : accionSiguiente(pedido.estado)}
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
