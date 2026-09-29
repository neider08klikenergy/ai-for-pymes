// Plantillas de WhatsApp (aprobadas por Meta) para avisar al cliente cuando
// pasaron más de 24 h desde su último mensaje: fuera de esa ventana WhatsApp
// solo deja enviar plantillas.
//
// Se crean como borrador en Settings → Templates (seed golosita_plantillas.sql)
// y se envían a aprobación desde ahí. Los nombres deben coincidir exactamente.

import type { DatosAviso } from "./mensajes";
import { fechaCorta, horaLocal, pesos } from "./fechas";

export type EventoPlantilla =
  | "pago_confirmado"
  | "pago_rechazado"
  | "listo"
  | "cancelado"
  | "recordatorio";

export interface DefinicionPlantilla {
  nombre: string;
  categoria: "utility";
  cuerpo: string;
  pie: string;
  /** Ejemplo por variable, en orden ({{1}}, {{2}}…). Meta los exige. */
  ejemplos: string[];
  uso: string;
}

const PIE = "Golosita";

export const PLANTILLAS: Record<EventoPlantilla, DefinicionPlantilla> = {
  pago_confirmado: {
    nombre: "pedido_pago_confirmado",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, confirmamos el pago de {{2}} de tu pedido {{3}}. " +
      "La entrega quedó agendada para el {{4}} en {{5}}. Saldo pendiente: {{6}}.",
    pie: PIE,
    ejemplos: ["Neider", "$ 90.000", "GOL-00012", "jue, 1 de oct a las 3:00 p. m.", "Golosita Caudal (Grama)", "$ 60.000"],
    uso: "Al confirmar un pago desde el panel, si el cliente no escribe hace más de 24 h.",
  },
  pago_rechazado: {
    nombre: "pedido_pago_rechazado",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, no pudimos verificar el pago de tu pedido {{2}}. Motivo: {{3}}. " +
      "Por favor envíanos de nuevo el comprobante respondiendo a este mensaje.",
    pie: PIE,
    ejemplos: ["Neider", "GOL-00012", "la transferencia no aparece en la cuenta"],
    uso: "Al rechazar un comprobante desde el panel, fuera de la ventana de 24 h.",
  },
  listo: {
    nombre: "pedido_listo",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, tu pedido {{2}} ya está listo para entregar en {{3}}. " +
      "Saldo pendiente al momento de la entrega: {{4}}.",
    pie: PIE,
    ejemplos: ["Neider", "GOL-00012", "Golosita Caudal (Grama)", "$ 60.000"],
    uso: "Al marcar un pedido como listo, fuera de la ventana de 24 h.",
  },
  cancelado: {
    nombre: "pedido_cancelado",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, tu pedido {{2}} quedó cancelado. {{3}} " +
      "Si tienes alguna duda, responde a este mensaje.",
    pie: PIE,
    ejemplos: ["Neider", "GOL-00012", "Tu saldo a favor es de $ 90.000 y está vigente hasta el 29 mar 2027."],
    uso: "Al cancelar un pedido, fuera de la ventana de 24 h.",
  },
  recordatorio: {
    nombre: "pedido_recordatorio",
    categoria: "utility",
    cuerpo:
      "Hola {{1}}, te recordamos que tu pedido {{2}} se entrega mañana {{3}} en {{4}}. " +
      "Saldo pendiente: {{5}}.",
    pie: PIE,
    ejemplos: ["Neider", "GOL-00012", "a las 3:00 p. m.", "Golosita Caudal (Grama)", "$ 60.000"],
    uso: "Recordatorio automático el día anterior a la entrega (pendiente de programar).",
  },
};

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] || "cliente";
}

function lugar(p: DatosAviso): string {
  if (p.modalidad === "domicilio") return "tu dirección";
  return p.sede_nombre ?? "la sede";
}

/**
 * Valores de las variables de la plantilla, en orden. Meta no acepta
 * variables vacías ni con saltos de línea: se limpian aquí.
 */
export function parametrosPlantilla(
  evento: EventoPlantilla,
  p: DatosAviso,
  zona: string,
  extra: { monto?: number; motivo?: string; saldoFavor?: { monto: number; vence: string } } = {},
): string[] {
  const saldoTrasPago = Math.max(p.total - p.pagado - (extra.monto ?? 0), 0);
  const saldo = Math.max(p.total - p.pagado, 0);
  const cuando = `${fechaCorta(p.fecha_entrega, zona)} a las ${horaLocal(p.fecha_entrega, zona)}`;

  let valores: string[];
  switch (evento) {
    case "pago_confirmado":
      valores = [primerNombre(p.nombre_cliente), pesos(extra.monto ?? 0), p.numero, cuando, lugar(p), pesos(saldoTrasPago)];
      break;
    case "pago_rechazado":
      valores = [primerNombre(p.nombre_cliente), p.numero, extra.motivo?.trim() || "no encontramos la transferencia"];
      break;
    case "listo":
      valores = [primerNombre(p.nombre_cliente), p.numero, lugar(p), pesos(saldo)];
      break;
    case "cancelado":
      valores = [
        primerNombre(p.nombre_cliente),
        p.numero,
        extra.saldoFavor && extra.saldoFavor.monto > 0
          ? `Tu saldo a favor es de ${pesos(extra.saldoFavor.monto)} y está vigente hasta el ${extra.saldoFavor.vence}.`
          : p.pagado > 0
            ? "Según la política de cancelación, el pago realizado no queda como saldo a favor."
            : "No tenías pagos registrados en este pedido.",
      ];
      break;
    case "recordatorio":
      valores = [primerNombre(p.nombre_cliente), p.numero, `a las ${horaLocal(p.fecha_entrega, zona)}`, lugar(p), pesos(saldo)];
      break;
  }
  return valores.map((v) => v.replace(/\s+/g, " ").trim().slice(0, 300) || "-");
}

/** Cuántas variables tiene el cuerpo ({{1}}…{{n}}). */
export function contarVariables(cuerpo: string): number {
  return new Set(cuerpo.match(/\{\{\d+\}\}/g) ?? []).size;
}
