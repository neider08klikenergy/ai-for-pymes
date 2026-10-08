"use client";

import {
  horaLocal,
  nombreMes,
  sumarMeses,
  fechaCorta,
  fechaLocalDe,
  semanasDelMes,
} from "../lib/fechas";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ESTADO_PUNTO } from "./comun";
import { CupoDelDia } from "./cupo-dia";
import { Button } from "@/components/ui/button";
import type { CupoDia, PedidoFila } from "../types";
import type { FiltrosPedidos } from "../lib/filtros";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TablaPedidos, type AccionesFila } from "./pedidos-tabla";
import { ESTADOS_PEDIDO, type EstadoPedido } from "../lib/estados";

// Encabezado de la semana (lunes a domingo): pedidos.calendario.dias.*
const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
const MAX_EN_CELDA = 3;

export function CalendarioPedidos({
  pedidos,
  filtros,
  hoy,
  zona,
  mostrarSede,
  acciones,
  onCambiar,
  cupos = [],
  puedeActuar = true,
}: {
  pedidos: PedidoFila[];
  /** Cupo de personalizados del día elegido, por sede. */
  cupos?: CupoDia[];
  puedeActuar?: boolean;
  filtros: FiltrosPedidos;
  hoy: string;
  zona: string;
  mostrarSede: boolean;
  acciones: AccionesFila;
  onCambiar: (cambios: Partial<FiltrosPedidos>) => void;
}) {
  const semanas = useMemo(() => semanasDelMes(filtros.mes), [filtros.mes]);
  const t = useTranslations("pedidos.calendario");
  const tt = useTranslations("pedidos.tabla");
  const idioma = useLocale();

  const porDia = useMemo(() => {
    const m = new Map<string, PedidoFila[]>();
    for (const p of pedidos) {
      const dia = fechaLocalDe(p.fecha_entrega, zona);
      const lista = m.get(dia) ?? [];
      lista.push(p);
      m.set(dia, lista);
    }
    return m;
  }, [pedidos, zona]);

  const diaSel = filtros.dia;
  const delDia = diaSel ? (porDia.get(diaSel) ?? []) : [];

  const totalMes = pedidos.filter((p) =>
    fechaLocalDe(p.fecha_entrega, zona).startsWith(filtros.mes),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("mesAnterior")}
            onClick={() =>
              onCambiar({ mes: sumarMeses(filtros.mes, -1), dia: null })
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="min-w-[160px] text-center font-display text-base font-semibold">
            {nombreMes(filtros.mes, idioma)}
          </h2>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("mesSiguiente")}
            onClick={() =>
              onCambiar({ mes: sumarMeses(filtros.mes, 1), dia: null })
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {filtros.mes !== hoy.slice(0, 7) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCambiar({ mes: hoy.slice(0, 7), dia: hoy })}
            >
              {tt("hoy")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {totalMes} {totalMes === 1 ? "pedido" : "pedidos"} este mes (sin
          cancelados)
        </p>
      </div>

      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border/50 bg-muted/30">
          {DIAS.map((d) => (
            <div
              key={d}
              className="px-1 py-1.5 text-center text-[11px] font-medium text-muted-foreground"
            >
              {t(`dias.${d}`)}
            </div>
          ))}
        </div>
        {semanas.map((semana) => (
          <div
            key={semana[0]}
            className="grid grid-cols-7 border-b border-border/30 last:border-b-0"
          >
            {semana.map((dia) => {
              const lista = porDia.get(dia) ?? [];
              const fuera = !dia.startsWith(filtros.mes);
              const esHoy = dia === hoy;
              const sel = dia === diaSel;
              return (
                <button
                  key={dia}
                  type="button"
                  onClick={() => onCambiar({ dia: sel ? null : dia })}
                  aria-pressed={sel}
                  aria-label={t("celda", {
                    fecha: fechaCorta(`${dia}T12:00:00Z`, "UTC", idioma),
                    n: lista.length,
                  })}
                  className={cn(
                    "flex min-h-[64px] md:min-h-[104px] min-w-0 flex-col justify-start border-r border-border/30 last:border-r-0 p-1 md:p-1.5 text-left transition-colors",
                    "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    fuera && "bg-muted/10 text-muted-foreground/50",
                    sel && "bg-primary/10 ring-2 ring-inset ring-primary/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                        esHoy &&
                          "bg-primary text-primary-foreground font-semibold",
                      )}
                    >
                      {Number(dia.slice(8))}
                    </span>
                    {lista.length > 0 && (
                      <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums md:hidden">
                        {lista.length}
                      </span>
                    )}
                  </div>
                  {/* Celular: puntos por estado */}
                  {lista.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">
                      {lista.slice(0, 6).map((p) => (
                        <span
                          key={p.id}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            ESTADO_PUNTO[p.estado],
                          )}
                        />
                      ))}
                    </div>
                  )}
                  {/* Escritorio: los primeros pedidos del día */}
                  <ul className="mt-1 hidden md:grid gap-0.5">
                    {lista.slice(0, MAX_EN_CELDA).map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-1 text-[11px] leading-tight"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            ESTADO_PUNTO[p.estado],
                          )}
                        />
                        <span className="tabular-nums text-muted-foreground">
                          {horaLocal(p.fecha_entrega, zona, idioma).replace(
                            /\s?([ap]\.\s?m\.|[AP]M)/i,
                            "",
                          )}
                        </span>
                        <span className="truncate">
                          {p.nombre_cliente.split(" ")[0]}
                        </span>
                      </li>
                    ))}
                    {lista.length > MAX_EN_CELDA && (
                      <li className="text-[11px] text-muted-foreground">
                        {t("mas", { n: lista.length - MAX_EN_CELDA })}
                      </li>
                    )}
                  </ul>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <Leyenda />

      {diaSel && (
        <section className="flex flex-col gap-2" aria-labelledby="dia-titulo">
          <h3 id="dia-titulo" className="text-sm font-semibold">
            {t("entregasDel", {
              fecha: fechaCorta(`${diaSel}T12:00:00Z`, "UTC", idioma),
            })}{" "}
            <span className="font-normal text-muted-foreground">
              ({delDia.length})
            </span>
          </h3>
          {cupos
            .filter((c) => c.fecha === diaSel)
            .map((c) => (
              <CupoDelDia
                key={`${c.sede_id}-${c.fecha}`}
                cupo={c}
                puedeActuar={puedeActuar}
              />
            ))}
          <TablaPedidos
            pedidos={delDia}
            zona={zona}
            mostrarFecha={false}
            mostrarSede={mostrarSede}
            acciones={acciones}
            vacio={t("vacioDia")}
          />
        </section>
      )}
      {!diaSel && (
        <p className="text-xs text-muted-foreground">{t("tocaDia")}</p>
      )}
    </div>
  );
}

function Leyenda() {
  const te = useTranslations("pedidos.estados");
  const estados = ESTADOS_PEDIDO.filter(
    (e): e is Exclude<EstadoPedido, "cancelado"> => e !== "cancelado",
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {estados.map((e) => (
        <span
          key={e}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span className={cn("h-2 w-2 rounded-full", ESTADO_PUNTO[e])} />
          {te(e)}
        </span>
      ))}
    </div>
  );
}
