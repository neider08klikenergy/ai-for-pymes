import type { EstadoPedido } from "./lib/estados";

export interface SedeResumen {
  id: string;
  codigo: string;
  nombre: string;
}

export interface PedidoFila {
  id: string;
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
  fecha_entrega: string;
  total: number;
  anticipo_requerido: number;
  pagado: number;
  saldo: number;
  precio_validado: boolean;
  conversation_id: string | null;
  notas: string | null;
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
    sede_nombre: string | null;
    conversation_id: string | null;
  } | null;
}

export interface VistaPedidos {
  zona: string;
  fecha: string;
  sedeCodigo: string | null;
  sedes: SedeResumen[];
  pedidos: PedidoFila[];
  pagos: PagoPorVerificar[];
}
