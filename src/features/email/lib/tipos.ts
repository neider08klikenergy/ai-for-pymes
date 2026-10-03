// Tipos de aviso que pueden llegar por correo (los mismos de la campana).

export const TIPOS_CORREO = [
  "pedido_nuevo",
  "pago_por_verificar",
  "handoff",
  "cliente_esperando",
  "ia_retomo",
] as const;

export type TipoCorreo = (typeof TIPOS_CORREO)[number];

export const TIPO_CORREO_INFO: Record<TipoCorreo, { label: string; descripcion: string }> = {
  pedido_nuevo: {
    label: "Pedido nuevo",
    descripcion: "El agente registró un pedido.",
  },
  pago_por_verificar: {
    label: "Comprobante por verificar",
    descripcion: "Un cliente envió un comprobante de pago.",
  },
  handoff: {
    label: "Conversación para una persona",
    descripcion: "La IA pasó una conversación al equipo.",
  },
  cliente_esperando: {
    label: "Cliente esperando",
    descripcion: "Un cliente lleva varios minutos sin respuesta del equipo.",
  },
  ia_retomo: {
    label: "La IA retomó una conversación",
    descripcion: "Nadie respondió y la IA volvió a atender.",
  },
};

/** Lo que trae marcado quien activa los correos por primera vez. */
export const TIPOS_CORREO_POR_DEFECTO: TipoCorreo[] = [
  "pedido_nuevo",
  "pago_por_verificar",
  "handoff",
  "cliente_esperando",
];

export function isTipoCorreo(v: unknown): v is TipoCorreo {
  return typeof v === "string" && (TIPOS_CORREO as readonly string[]).includes(v);
}
