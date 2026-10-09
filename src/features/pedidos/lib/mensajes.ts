// Textos que se le envían al cliente por WhatsApp desde el panel.
// Son solo la propuesta: la persona los puede editar antes de enviar.

import { fechaCorta, horaLocal, pesos } from "./fechas";

export interface DatosAviso {
  numero: string;
  nombre_cliente: string;
  fecha_entrega: string;
  sede_nombre: string | null;
  modalidad: "recogida" | "domicilio";
  total: number;
  pagado: number;
  /** Sin él, el pago siempre se toma como suficiente para confirmar. */
  anticipo_requerido?: number;
}

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? "";
}

function cuando(p: DatosAviso, zona: string): string {
  return `${fechaCorta(p.fecha_entrega, zona)} a las ${horaLocal(p.fecha_entrega, zona)}`;
}

function donde(p: DatosAviso): string {
  if (p.modalidad === "domicilio") return "con entrega a domicilio";
  return p.sede_nombre ? `en ${p.sede_nombre}` : "en la sede";
}

export function mensajePagoConfirmado(p: DatosAviso, monto: number, zona: string): string {
  const debe = Math.max(p.total - p.pagado, 0);
  const saldo = Math.max(debe - monto, 0);
  const excedente = Math.max(monto - debe, 0);
  // Sin anticipo no hay cupo: un pago que no lo completa no confirma el pedido.
  const faltaAnticipo = Math.max((p.anticipo_requerido ?? 0) - p.pagado - monto, 0);
  if (faltaAnticipo > 0) {
    return [
      `✅ ¡Hola ${primerNombre(p.nombre_cliente)}! Recibimos tu pago de ${pesos(monto)} para el pedido ${p.numero}.`,
      `Para confirmarlo y separar tu cupo del ${cuando(p, zona)} faltan ${pesos(faltaAnticipo)} del anticipo.`,
      "Cuando los transfieras, envíanos el comprobante por aquí. ¡Gracias! 💛",
    ].join("\n");
  }
  const lineas = [
    `✅ ¡Hola ${primerNombre(p.nombre_cliente)}! Recibimos tu pago de ${pesos(monto)}.`,
    `Tu pedido ${p.numero} quedó confirmado para el ${cuando(p, zona)} ${donde(p)}.`,
  ];
  if (excedente > 0) {
    lineas.push(
      `Nos llegaron ${pesos(excedente)} de más; en un momento te confirmamos qué hacemos con ese valor.`,
    );
  }
  lineas.push(
    saldo <= 0
      ? "Tu pedido quedó pagado en su totalidad."
      : p.modalidad === "domicilio"
        ? `El saldo de ${pesos(saldo)} (incluye el domicilio) lo transfieres antes del envío.`
        : `El saldo de ${pesos(saldo)} lo pagas al momento de la entrega.`,
  );
  lineas.push("¡Gracias por elegir Golosita! 💛");
  return lineas.join("\n");
}

export function mensajePagoRechazado(p: DatosAviso, motivo: string): string {
  const razon = motivo.trim() ? `: ${motivo.trim().replace(/\.$/, "")}` : "";
  return [
    `Hola ${primerNombre(p.nombre_cliente)}, no pudimos verificar el pago de tu pedido ${p.numero}${razon}.`,
    "¿Nos envías de nuevo el comprobante o nos confirmas la transferencia? Tu pedido queda pendiente mientras tanto.",
  ].join("\n");
}

export function mensajePedidoListo(p: DatosAviso): string {
  const saldo = Math.max(p.total - p.pagado, 0);
  const lineas = [
    p.modalidad === "domicilio"
      ? `🎂 ¡Hola ${primerNombre(p.nombre_cliente)}! Tu pedido ${p.numero} ya está listo y pronto sale hacia tu dirección.`
      : `🎂 ¡Hola ${primerNombre(p.nombre_cliente)}! Tu pedido ${p.numero} ya está listo para recoger ${donde(p)}.`,
  ];
  if (saldo > 0) {
    lineas.push(
      p.modalidad === "domicilio"
        ? `Para despacharlo, transfiere el saldo de ${pesos(saldo)} (incluye el domicilio) y envíanos el comprobante por aquí.`
        : `Recuerda el saldo de ${pesos(saldo)} al momento de la entrega.`,
    );
  }
  return lineas.join("\n");
}

export function mensajePedidoCancelado(
  p: DatosAviso,
  saldo: { generar: boolean; meses: number } = { generar: p.pagado > 0, meses: 6 },
): string {
  const lineas = [`Hola ${primerNombre(p.nombre_cliente)}, tu pedido ${p.numero} quedó cancelado.`];
  if (p.pagado > 0 && saldo.generar) {
    lineas.push(
      `Los ${pesos(p.pagado)} que pagaste quedan como saldo a favor por ${saldo.meses} meses para tu próximo pedido.`,
    );
  }
  lineas.push("Si tienes alguna duda, escríbenos por aquí.");
  return lineas.join("\n");
}
