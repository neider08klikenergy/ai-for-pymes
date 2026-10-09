import type { EstadoPedido } from "./lib/estados";
import type { FiltrosPedidos } from "./lib/filtros";

export interface SedeResumen {
  id: string;
  codigo: string;
  nombre: string;
  acepta_personalizados?: boolean;
}

/** Cupo de personalizados de una sede en un día (pd_estado_cupo_dia). */
export interface CupoDia {
  sede_id: string;
  sede: string;
  fecha: string;
  usados: number;
  cupo_automatico: number;
  cupo_maximo: number;
  cupo_sede: number;
  cupo_maximo_sede: number | null;
  ajustado: boolean;
  cerrado: boolean;
  nota: string | null;
  sin_limite: boolean;
}

export interface PagoResumen {
  id: string;
  tipo: "anticipo" | "saldo" | "total" | "saldo_favor";
  estado: "por_verificar" | "confirmado" | "rechazado";
  monto_esperado: number;
  monto_reportado: number | null;
  referencia: string | null;
  motivo_rechazo: string | null;
  /** Lo que decía el comprobante, si se confirmó otro monto. */
  monto_comprobante: number | null;
  /** Por qué se confirmó un monto distinto al del comprobante. */
  nota_revision: string | null;
  /** Lo que el cliente pagó de más (no suma a lo pagado del pedido). */
  excedente: number;
  /** null si no hubo excedente. */
  excedente_destino: "por_decidir" | "saldo_favor" | "propina" | null;
  created_at: string;
}

export interface SaldoFavorGenerado {
  monto_inicial: number;
  monto_disponible: number;
  vence_at: string;
  estado: "disponible" | "agotado" | "anulado";
}

export interface PedidoFila {
  id: string;
  contact_id: string | null;
  numero: string;
  estado: EstadoPedido;
  sede: SedeResumen | null;
  nombre_cliente: string;
  telefono: string | null;
  linea: string;
  sabor: string;
  tamano: string;
  cantidad: number;
  detalle: Record<string, string>;
  modalidad: "recogida" | "domicilio";
  direccion_entrega: string | null;
  /** Incluido en total. 0 si recoge en sede. */
  valor_domicilio: number;
  /**
   * tarifa: de la configuración · persona: lo fijó el equipo en el panel ·
   * pendiente: sin tarifa, falta que el equipo lo fije (valor 0 hasta entonces).
   */
  domicilio_origen: "tarifa" | "persona" | "pendiente" | null;
  fecha_entrega: string;
  total: number;
  anticipo_requerido: number;
  pagado: number;
  saldo: number;
  precio_validado: boolean;
  conversation_id: string | null;
  notas: string | null;
  created_at: string;
  /** true/false según la ventana de 24 h de WhatsApp; null sin conversación. */
  ventana_abierta: boolean | null;
  pagos: PagoResumen[];
  /** Saldo a favor que dejó este pedido al cancelarse. */
  saldo_favor_generado: SaldoFavorGenerado | null;
  /** Saldo a favor vigente del cliente (para pagar este pedido). */
  saldo_favor_cliente: number;
}

export interface PagoPorVerificar {
  id: string;
  tipo: "anticipo" | "saldo" | "total";
  monto_esperado: number;
  monto_reportado: number | null;
  referencia: string | null;
  banco: string | null;
  fecha_pago: string | null;
  descripcion_ia: string | null;
  created_at: string;
  /** Ruta del comprobante en Storage; la URL firmada se pide al abrirlo. */
  storage_path: string | null;
  mime_type: string | null;
  pedido: {
    id: string;
    numero: string;
    nombre_cliente: string;
    fecha_entrega: string;
    total: number;
    pagado: number;
    anticipo_requerido: number;
    modalidad: "recogida" | "domicilio";
    sede_nombre: string | null;
    conversation_id: string | null;
    ventana_abierta: boolean | null;
  } | null;
}

export interface VistaPedidos {
  zona: string;
  hoy: string;
  filtros: FiltrosPedidos;
  sedes: SedeResumen[];
  /** Tabla: pedidos del rango. Calendario: pedidos del mes (sin cancelados). */
  pedidos: PedidoFila[];
  /** Solo en la vista de pagos. */
  pagos: PagoPorVerificar[];
  pagosPendientes: number;
  /** true si se cortó la lista en el límite. */
  truncado: boolean;
  reglas: { cancelacionDias: number; saldoFavorMeses: number };
  /** Calendario con un día elegido: cupo de personalizados por sede. */
  cupos: CupoDia[];
}
