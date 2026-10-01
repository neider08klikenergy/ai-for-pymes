"use client";

import {
  aplicarSaldoFavor,
  cambiarEstadoPedido,
} from "../services/pedidos-actions";
import {
  ListoDialog,
  RevisionDialog,
  CancelarDialog,
  type CambioPendiente,
  type RevisionPendiente,
} from "./dialogos";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toastResultado } from "./comun";
import { PagosLista } from "./pagos-lista";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { siguienteEstado } from "../lib/estados";
import { PedidoDetalle } from "./pedido-detalle";
import { CalendarioPedidos } from "./pedidos-calendario";
import type { PedidoFila, VistaPedidos } from "../types";
import { CalendarDays, Clock, Receipt, Table2, Wallet } from "lucide-react";
import { urlPedidos, type FiltrosPedidos, type Vista } from "../lib/filtros";
import { FiltrosTabla, TablaPedidos, type AccionesFila } from "./pedidos-tabla";

interface PedidosBoardProps {
  vista: VistaPedidos;
  /** false para el rol viewer: solo lectura. */
  puedeActuar: boolean;
}

const PESTANAS: {
  vista: Vista;
  label: string;
  corto: string;
  Icon: React.ElementType;
}[] = [
  { vista: "tabla", label: "Tabla", corto: "Tabla", Icon: Table2 },
  {
    vista: "calendario",
    label: "Calendario",
    corto: "Calendario",
    Icon: CalendarDays,
  },
  {
    vista: "pagos",
    label: "Pagos por verificar",
    corto: "Pagos",
    Icon: Wallet,
  },
];

export function PedidosBoard({ vista, puedeActuar }: PedidosBoardProps) {
  const router = useRouter();
  const { filtros, hoy, zona } = vista;

  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const [revision, setRevision] = useState<RevisionPendiente | null>(null);
  const [cambio, setCambio] = useState<CambioPendiente | null>(null);
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Se busca en los datos frescos: tras una acción, el servidor revalida y el
  // detalle abierto muestra el estado nuevo.
  const seleccionado =
    vista.pedidos.find((p) => p.id === seleccionadoId) ?? null;

  function ir(cambios: Partial<FiltrosPedidos>) {
    router.push(urlPedidos({ ...filtros, ...cambios }, hoy), { scroll: false });
  }

  function avanzar(p: PedidoFila) {
    const hacia = siguienteEstado(p.estado);
    if (!hacia) return;
    // "Listo" se le avisa al cliente: pasa por el diálogo con el mensaje.
    if (hacia === "listo") return setCambio({ pedido: p, hacia: "listo" });
    setOcupadoId(p.id);
    startTransition(async () => {
      const r = await cambiarEstadoPedido({
        pedidoId: p.id,
        hacia,
        aviso: null,
      });
      toastResultado(r);
      setOcupadoId(null);
    });
  }

  function aplicarSaldo(p: PedidoFila) {
    setOcupadoId(p.id);
    startTransition(async () => {
      toastResultado(await aplicarSaldoFavor(p.id));
      setOcupadoId(null);
    });
  }

  const acciones: AccionesFila = {
    puedeActuar,
    ocupadoId,
    onVer: (p) => setSeleccionadoId(p.id),
    onAvanzar: avanzar,
  };

  const sinSedes = vista.sedes.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="font-display text-xl font-semibold">Pedidos</h1>
        </div>
        {vista.sedes.length > 1 && filtros.vista !== "pagos" && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Sede">
            <Button
              size="sm"
              variant={filtros.sede === null ? "default" : "outline"}
              onClick={() => ir({ sede: null })}
            >
              Todas
            </Button>
            {vista.sedes.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={filtros.sede === s.codigo ? "default" : "outline"}
                onClick={() => ir({ sede: s.codigo })}
              >
                {s.nombre.replace(/^Golosita\s+/i, "")}
              </Button>
            ))}
          </div>
        )}
      </div>

      <nav
        className="flex gap-1 overflow-x-auto rounded-xl bg-muted/40 p-1 w-fit max-w-full"
        aria-label="Vistas de pedidos"
      >
        {PESTANAS.map(({ vista: v, label, corto, Icon }) => {
          const activa = filtros.vista === v;
          return (
            <Link
              key={v}
              href={urlPedidos({ ...filtros, vista: v }, hoy)}
              scroll={false}
              aria-current={activa ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                activa
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="sm:hidden">{corto}</span>
              <span className="hidden sm:inline">{label}</span>
              {v === "pagos" && vista.pagosPendientes > 0 && (
                <span className="rounded-full bg-warning/20 px-1.5 text-xs font-semibold text-warning tabular-nums">
                  {vista.pagosPendientes}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {sinSedes && (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Este workspace todavía no tiene sedes. Carga el seed del negocio para
          usar pedidos.
        </p>
      )}

      {filtros.vista === "tabla" && (
        <div className="flex flex-col gap-4">
          <FiltrosTabla filtros={filtros} hoy={hoy} onCambiar={ir} />
          <TablaPedidos
            pedidos={vista.pedidos}
            zona={zona}
            mostrarFecha={filtros.desde !== filtros.hasta}
            mostrarSede={filtros.sede === null}
            acciones={acciones}
            vacio="No hay pedidos con estos filtros."
          />
          {vista.truncado && (
            <p className="text-xs text-muted-foreground">
              Se muestran los primeros {vista.pedidos.length}. Acorta el rango
              de fechas para ver el resto.
            </p>
          )}
        </div>
      )}

      {filtros.vista === "calendario" && (
        <CalendarioPedidos
          pedidos={vista.pedidos}
          filtros={filtros}
          hoy={hoy}
          zona={zona}
          mostrarSede={filtros.sede === null}
          acciones={acciones}
          onCambiar={ir}
          cupos={vista.cupos}
          puedeActuar={puedeActuar}
        />
      )}

      {filtros.vista === "pagos" && (
        <PagosLista
          pagos={vista.pagos}
          zona={zona}
          puedeActuar={puedeActuar}
          onRevisar={(pago, aprobar) => setRevision({ pago, aprobar })}
        />
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden="true" />
        Horas en {zona}.
      </p>

      <PedidoDetalle
        pedido={seleccionado}
        zona={zona}
        puedeActuar={puedeActuar}
        ocupado={!!seleccionado && ocupadoId === seleccionado.id}
        onClose={() => setSeleccionadoId(null)}
        onAvanzar={avanzar}
        onCancelar={(p) => setCambio({ pedido: p, hacia: "cancelado" })}
        onAplicarSaldo={aplicarSaldo}
      />

      {revision && (
        <RevisionDialog
          key={`${revision.pago.id}:${revision.aprobar}`}
          revision={revision}
          zona={zona}
          onClose={() => setRevision(null)}
        />
      )}
      {cambio?.hacia === "listo" && (
        <ListoDialog
          key={`listo:${cambio.pedido.id}`}
          pedido={cambio.pedido}
          onClose={() => setCambio(null)}
        />
      )}
      {cambio?.hacia === "cancelado" && (
        <CancelarDialog
          key={`cancelar:${cambio.pedido.id}`}
          pedido={cambio.pedido}
          zona={zona}
          reglas={vista.reglas}
          onClose={() => setCambio(null)}
        />
      )}
    </div>
  );
}
