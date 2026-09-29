// Filtros de la pantalla Pedidos, leídos de la URL (?vista=&desde=…).

import { ESTADOS_PEDIDO, type EstadoPedido } from "./estados";
import { esFechaValida, esMesValido, sumarDias } from "./fechas";

export const VISTAS = ["tabla", "calendario", "pagos"] as const;
export type Vista = (typeof VISTAS)[number];

/** "activos" = todo menos entregado y cancelado. */
export type FiltroEstado = EstadoPedido | "activos" | "todos";

export interface FiltrosPedidos {
  vista: Vista;
  desde: string;
  hasta: string;
  estado: FiltroEstado;
  sede: string | null;
  q: string;
  mes: string;
  dia: string | null;
}

export type ParamsPedidos = Partial<Record<keyof FiltrosPedidos, string | string[] | undefined>>;

function uno(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const DIAS_POR_DEFECTO = 30;
const RANGO_MAXIMO_DIAS = 366;

export function leerFiltros(params: ParamsPedidos, hoy: string): FiltrosPedidos {
  const vistaRaw = uno(params.vista);
  const vista: Vista = (VISTAS as readonly string[]).includes(vistaRaw ?? "")
    ? (vistaRaw as Vista)
    : "tabla";

  const desdeRaw = uno(params.desde);
  const hastaRaw = uno(params.hasta);
  let desde = esFechaValida(desdeRaw) ? desdeRaw : hoy;
  let hasta = esFechaValida(hastaRaw) ? hastaRaw : sumarDias(desde, DIAS_POR_DEFECTO);
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (hasta > sumarDias(desde, RANGO_MAXIMO_DIAS)) hasta = sumarDias(desde, RANGO_MAXIMO_DIAS);

  const estadoRaw = uno(params.estado);
  const estado: FiltroEstado =
    estadoRaw === "todos" || (ESTADOS_PEDIDO as readonly string[]).includes(estadoRaw ?? "")
      ? (estadoRaw as FiltroEstado)
      : "activos";

  const mesRaw = uno(params.mes);
  const diaRaw = uno(params.dia);
  const mes = esMesValido(mesRaw) ? mesRaw : hoy.slice(0, 7);

  return {
    vista,
    desde,
    hasta,
    estado,
    sede: uno(params.sede)?.trim() || null,
    q: (uno(params.q) ?? "").trim().slice(0, 60),
    mes,
    dia: esFechaValida(diaRaw) ? diaRaw : null,
  };
}

/** Arma la URL de /pedidos con solo lo que difiere de los valores por defecto. */
export function urlPedidos(f: FiltrosPedidos, hoy: string): string {
  const p = new URLSearchParams();
  if (f.vista !== "tabla") p.set("vista", f.vista);
  if (f.vista === "tabla") {
    if (f.desde !== hoy) p.set("desde", f.desde);
    if (f.hasta !== sumarDias(f.desde, DIAS_POR_DEFECTO)) p.set("hasta", f.hasta);
    if (f.estado !== "activos") p.set("estado", f.estado);
    if (f.q) p.set("q", f.q);
  }
  if (f.vista === "calendario") {
    if (f.mes !== hoy.slice(0, 7)) p.set("mes", f.mes);
    if (f.dia) p.set("dia", f.dia);
  }
  if (f.sede && f.vista !== "pagos") p.set("sede", f.sede);
  const qs = p.toString();
  return qs ? `/pedidos?${qs}` : "/pedidos";
}
