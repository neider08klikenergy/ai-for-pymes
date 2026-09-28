import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { callPedidosRpc } from "./rpc";

const schema = z.object({
  sede: z.string().describe("Código de la sede, ej: caudal"),
  linea: z.string().describe("Línea del producto, ej: ponque_personalizado"),
  sabor: z.string().optional().describe("Sabor exacto del tarifario"),
  tamano: z.string().describe("Tamaño exacto del tarifario, ej: 1/2 lb"),
  cantidad: z.number().int().min(1).max(50).optional().describe("Unidades (por defecto 1)"),
  fecha_entrega: z
    .string()
    .describe("Fecha y hora de entrega en hora local, formato YYYY-MM-DDTHH:MM"),
  nombre_cliente: z.string().min(2).describe("Nombre de quien recibe el pedido"),
  telefono: z
    .string()
    .optional()
    .describe("Teléfono de contacto si es distinto al de WhatsApp"),
  modalidad: z
    .enum(["recogida", "domicilio"])
    .optional()
    .describe("recogida en sede (por defecto) o domicilio"),
  direccion_entrega: z.string().optional().describe("Obligatoria si es domicilio"),
  decoracion: z
    .string()
    .optional()
    .describe("Diseño o código del catálogo (ej: M-07), colores y decoración pedida"),
  mensaje_ponque: z.string().optional().describe("Texto a escribir en el ponqué"),
  forma: z.string().optional().describe("Forma del molde si aplica (redondo, corazón…)"),
  notas: z.string().optional().describe("Otras indicaciones del cliente"),
});

type Args = z.infer<typeof schema>;

export const registrarPedidoTool: Tool<Args> = {
  name: "registrar_pedido",
  description:
    "Crea el pedido con el precio oficial (queda 'pendiente de anticipo'). Úsala SOLO cuando el cliente " +
    "confirmó sede, producto, sabor, tamaño, fecha/hora, nombre y decoración, y después de consultar_cupo. " +
    "Devuelve número de pedido, total, anticipo y saldo contra entrega para informarle al cliente.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run: (args: Args, ctx: ToolContext): Promise<ToolResult> => {
    const detalle: Record<string, string> = {};
    if (args.decoracion) detalle.decoracion = args.decoracion;
    if (args.mensaje_ponque) detalle.mensaje = args.mensaje_ponque;
    if (args.forma) detalle.forma = args.forma;
    if (args.notas) detalle.notas = args.notas;

    return callPedidosRpc("pd_registrar_pedido", {
      p_ws: ctx.workspaceId,
      p_conversation_id: ctx.conversationId || null,
      p_contact_id: ctx.contactId || null,
      p_sede_codigo: args.sede,
      p_linea: args.linea,
      p_sabor: args.sabor ?? null,
      p_tamano: args.tamano,
      p_cantidad: args.cantidad ?? 1,
      p_fecha_entrega: args.fecha_entrega,
      p_nombre_cliente: args.nombre_cliente,
      p_telefono: args.telefono ?? null,
      p_modalidad: args.modalidad ?? "recogida",
      p_direccion: args.direccion_entrega ?? null,
      p_detalle: detalle,
    });
  },
};
