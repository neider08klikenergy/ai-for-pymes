"use client";

import {
  Select,
  SelectItem,
  SelectValue,
  SelectTrigger,
  SelectContent,
} from "@/components/ui/select";
import {
  Table,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from "@/components/ui/table";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { PedidoFila } from "../types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { FiltroEstado, FiltrosPedidos } from "../lib/filtros";
import { ACCION_SIGUIENTE, EstadoBadge, nombreProducto } from "./comun";
import { fechaCorta, horaLocal, pesos, sumarDias } from "../lib/fechas";
import { AlertTriangle, ChevronRight, Search, Truck, X } from "lucide-react";
import { ESTADOS_PEDIDO, ESTADO_LABEL, siguienteEstado } from "../lib/estados";

export interface AccionesFila {
  puedeActuar: boolean;
  ocupadoId: string | null;
  onVer: (p: PedidoFila) => void;
  onAvanzar: (p: PedidoFila) => void;
}

// ── Barra de filtros ─────────────────────────────────────────────────────────

export function FiltrosTabla({
  filtros,
  hoy,
  onCambiar,
}: {
  filtros: FiltrosPedidos;
  hoy: string;
  onCambiar: (cambios: Partial<FiltrosPedidos>) => void;
}) {
  const [q, setQ] = useState(filtros.q);

  const atajos: { label: string; desde: string; hasta: string }[] = [
    { label: "Hoy", desde: hoy, hasta: hoy },
    { label: "Mañana", desde: sumarDias(hoy, 1), hasta: sumarDias(hoy, 1) },
    { label: "7 días", desde: hoy, hasta: sumarDias(hoy, 7) },
    { label: "30 días", desde: hoy, hasta: sumarDias(hoy, 30) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            onCambiar({ q: q.trim() });
          }}
        >
          <Search
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por número, nombre o teléfono (Enter)"
            aria-label="Buscar pedidos"
            className="pl-8 pr-8"
          />
          {q && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setQ("");
                onCambiar({ q: "" });
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>
        <Select
          value={filtros.estado}
          onValueChange={(v) => onCambiar({ estado: v as FiltroEstado })}
        >
          <SelectTrigger className="sm:w-[200px]" aria-label="Estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="activos">Activos (sin entregados)</SelectItem>
            {ESTADOS_PEDIDO.map((e) => (
              <SelectItem key={e} value={e}>
                {ESTADO_LABEL[e]}
              </SelectItem>
            ))}
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-sm">
          <Input
            type="date"
            value={filtros.desde}
            onChange={(e) =>
              e.target.value && onCambiar({ desde: e.target.value })
            }
            className="w-[150px]"
            aria-label="Entrega desde"
          />
          <span className="text-muted-foreground">a</span>
          <Input
            type="date"
            value={filtros.hasta}
            min={filtros.desde}
            onChange={(e) =>
              e.target.value && onCambiar({ hasta: e.target.value })
            }
            className="w-[150px]"
            aria-label="Entrega hasta"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {atajos.map((a) => {
            const activo =
              filtros.desde === a.desde && filtros.hasta === a.hasta;
            return (
              <Button
                key={a.label}
                size="sm"
                variant={activo ? "secondary" : "ghost"}
                onClick={() => onCambiar({ desde: a.desde, hasta: a.hasta })}
              >
                {a.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Tabla (escritorio) + lista (celular) ─────────────────────────────────────

function BotonAvanzar({
  pedido,
  acciones,
}: {
  pedido: PedidoFila;
  acciones: AccionesFila;
}) {
  // Pago por verificar: el siguiente paso está en la pestaña de pagos.
  if (pedido.estado === "por_verificar" && acciones.puedeActuar) {
    return (
      <Link
        href="/pedidos?vista=pagos"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-7 items-center rounded-md border border-warning/40 px-2 text-xs text-warning hover:bg-warning/10"
      >
        Revisar pago
      </Link>
    );
  }
  const siguiente = siguienteEstado(pedido.estado);
  if (!acciones.puedeActuar || !siguiente) return null;
  const ocupado = acciones.ocupadoId === pedido.id;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      disabled={ocupado}
      onClick={(e) => {
        e.stopPropagation();
        acciones.onAvanzar(pedido);
      }}
    >
      {ocupado ? "Guardando…" : ACCION_SIGUIENTE[pedido.estado]}
    </Button>
  );
}

export function TablaPedidos({
  pedidos,
  zona,
  mostrarFecha,
  mostrarSede,
  acciones,
  vacio,
}: {
  pedidos: PedidoFila[];
  zona: string;
  mostrarFecha: boolean;
  mostrarSede: boolean;
  acciones: AccionesFila;
  vacio: string;
}) {
  if (pedidos.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {vacio}
      </p>
    );
  }

  return (
    <>
      {/* Escritorio */}
      <div className="hidden md:block rounded-xl border border-border/50 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entrega</TableHead>
              <TableHead>Pedido</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Producto</TableHead>
              {mostrarSede && <TableHead>Sede</TableHead>}
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedidos.map((p) => (
              <TableRow
                key={p.id}
                className={cn(
                  "cursor-pointer",
                  (p.estado === "cancelado" || p.estado === "entregado") &&
                    "opacity-60",
                )}
                onClick={() => acciones.onVer(p)}
              >
                <TableCell className="whitespace-nowrap">
                  {mostrarFecha && (
                    <span className="block text-xs text-muted-foreground">
                      {fechaCorta(p.fecha_entrega, zona)}
                    </span>
                  )}
                  <span className="font-medium tabular-nums">
                    {horaLocal(p.fecha_entrega, zona)}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs font-semibold">
                  {p.numero}
                </TableCell>
                <TableCell className="max-w-[160px]">
                  <span className="block truncate">{p.nombre_cliente}</span>
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate">{nombreProducto(p)}</span>
                    {p.modalidad === "domicilio" && (
                      <Truck
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-label="Domicilio"
                      />
                    )}
                    {!p.precio_validado && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 shrink-0 text-warning"
                        aria-label="Precio sin validar"
                      />
                    )}
                  </span>
                </TableCell>
                {mostrarSede && (
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {p.sede?.nombre.replace(/^Golosita\s+/i, "") ?? "—"}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {pesos(p.total)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    p.saldo > 0 && "text-warning",
                  )}
                >
                  {pesos(p.saldo)}
                </TableCell>
                <TableCell>
                  <EstadoBadge estado={p.estado} />
                </TableCell>
                <TableCell className="text-right">
                  <BotonAvanzar pedido={p} acciones={acciones} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Celular */}
      <ul className="md:hidden grid gap-2">
        {pedidos.map((p) => (
          <li key={p.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => acciones.onVer(p)}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") && acciones.onVer(p)
              }
              className={cn(
                "w-full min-w-0 rounded-xl border border-border/50 bg-card p-3 text-left flex flex-col gap-2",
                (p.estado === "cancelado" || p.estado === "entregado") &&
                  "opacity-60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium tabular-nums">
                  {mostrarFecha && `${fechaCorta(p.fecha_entrega, zona)} · `}
                  {horaLocal(p.fecha_entrega, zona)}
                </span>
                <EstadoBadge estado={p.estado} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">
                    <span className="font-mono text-xs font-semibold">
                      {p.numero}
                    </span>{" "}
                    · {p.nombre_cliente}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {nombreProducto(p)}
                    {mostrarSede && p.sede
                      ? ` · ${p.sede.nombre.replace(/^Golosita\s+/i, "")}`
                      : ""}
                  </p>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span
                  className={cn("tabular-nums", p.saldo > 0 && "text-warning")}
                >
                  Saldo {pesos(p.saldo)}
                </span>
                <BotonAvanzar pedido={p} acciones={acciones} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
