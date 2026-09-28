// Estados del pedido y transiciones que el equipo puede hacer desde el panel.
// Los pasos de pago (pendiente_anticipo → por_verificar → confirmado) los
// mueven el agente y pd_confirmar_pago, no estos botones.

export const ESTADOS_PEDIDO = [
  "pendiente_anticipo",
  "por_verificar",
  "confirmado",
  "en_produccion",
  "listo",
  "entregado",
  "cancelado",
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export const ESTADO_LABEL: Record<EstadoPedido, string> = {
  pendiente_anticipo: "Sin anticipo",
  por_verificar: "Pago por verificar",
  confirmado: "Confirmado",
  en_produccion: "En producción",
  listo: "Listo",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export const ESTADO_COLOR: Record<EstadoPedido, string> = {
  pendiente_anticipo: "bg-muted text-muted-foreground",
  por_verificar: "bg-warning/10 text-warning",
  confirmado: "bg-info/10 text-info",
  en_produccion: "bg-primary/10 text-primary",
  listo: "bg-success/10 text-success",
  entregado: "bg-muted text-muted-foreground",
  cancelado: "bg-destructive/10 text-destructive",
};

/** Siguiente paso de producción (botón principal de la tarjeta). */
const SIGUIENTE: Partial<Record<EstadoPedido, EstadoPedido>> = {
  confirmado: "en_produccion",
  en_produccion: "listo",
  listo: "entregado",
};

export function siguienteEstado(actual: EstadoPedido): EstadoPedido | null {
  return SIGUIENTE[actual] ?? null;
}

/** ¿Puede el equipo pasar el pedido de `desde` a `hacia` desde el panel? */
export function transicionPermitida(
  desde: EstadoPedido,
  hacia: EstadoPedido,
): boolean {
  if (hacia === "cancelado") {
    return desde !== "entregado" && desde !== "cancelado";
  }
  return SIGUIENTE[desde] === hacia;
}

export function esEstadoPedido(v: unknown): v is EstadoPedido {
  return typeof v === "string" && (ESTADOS_PEDIDO as readonly string[]).includes(v);
}
