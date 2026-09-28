import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { callPedidosRpc } from "./rpc";

const schema = z.object({
  numero_pedido: z
    .string()
    .optional()
    .describe("Número de pedido (ej: GOL-00012). Si se omite, usa el último pedido pendiente de esta conversación"),
  monto: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Monto que muestra el comprobante, en pesos, sin puntos (ej: 90000)"),
  referencia: z.string().optional().describe("Número de referencia o comprobante de la transferencia"),
  banco: z.string().optional().describe("Banco o billetera: Nequi, Bancolombia, Daviplata…"),
  fecha_pago: z.string().optional().describe("Fecha/hora que muestra el comprobante"),
});

type Args = z.infer<typeof schema>;

export const registrarComprobanteTool: Tool<Args> = {
  name: "registrar_comprobante",
  description:
    "Registra el comprobante de pago que envió el cliente (imagen o PDF) y deja el pedido 'por verificar'. " +
    "Úsala cuando el cliente mande el comprobante del anticipo o del saldo, con los datos que leíste de la imagen. " +
    "NUNCA digas que el pago está confirmado: una persona del equipo lo verifica.",
  sensitivity: "write",
  schema,
  enabledFor: () => true,
  run: (args: Args, ctx: ToolContext): Promise<ToolResult> =>
    callPedidosRpc("pd_registrar_comprobante", {
      p_ws: ctx.workspaceId,
      p_conversation_id: ctx.conversationId,
      p_numero_pedido: args.numero_pedido ?? null,
      p_monto_reportado: args.monto ?? null,
      p_referencia: args.referencia ?? null,
      p_banco: args.banco ?? null,
      p_fecha_pago: args.fecha_pago ?? null,
    }),
};
