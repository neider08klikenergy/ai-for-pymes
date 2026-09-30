import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { callPedidosRpc } from "./rpc";

const schema = z.object({
  sede: z.string().describe("Código de la sede que despacha el pedido, ej: caudal"),
  direccion: z
    .string()
    .min(3)
    .describe("Dirección de entrega con el barrio, tal como la dio el cliente"),
});

type Args = z.infer<typeof schema>;

export const cotizarDomicilioTool: Tool<Args> = {
  name: "cotizar_domicilio",
  description:
    "Valor del domicilio según las tarifas del negocio. Úsala cuando el pedido es a domicilio, ANTES de dar " +
    "el total y pedir el pago. Si requiere_persona=true no hay tarifa: dile al cliente que en un momento le " +
    "confirmas el valor y llama pasar_a_persona. Nunca inventes el valor del domicilio.",
  sensitivity: "read",
  schema,
  enabledFor: () => true,
  run: (args: Args, ctx: ToolContext): Promise<ToolResult> =>
    callPedidosRpc("pd_cotizar_domicilio", {
      p_ws: ctx.workspaceId,
      p_sede_codigo: args.sede,
      p_direccion: args.direccion,
    }),
};
