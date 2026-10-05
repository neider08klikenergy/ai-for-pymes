import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { callPedidosRpc } from "./rpc";

const schema = z.object({
  sede: z.string().describe("Código de la sede, ej: caudal, buque, amarilo"),
  fecha: z
    .string()
    .optional()
    .describe("Día a consultar en hora local, formato YYYY-MM-DD. Omite para hoy"),
  producto: z
    .string()
    .optional()
    .describe("Filtra por un producto, ej: golovesa, ponqué. Omite para ver todo"),
});

type Args = z.infer<typeof schema>;

export const consultarDisponibilidadTool: Tool<Args> = {
  name: "consultar_disponibilidad",
  description:
    "Dice qué productos hay en una sede para un día. menu_del_dia trae lo que el equipo cargó para ese día, " +
    "con la cantidad que queda (null = hay, sin contar unidades); solo ofrece de ahí los productos del día. " +
    "siempre_disponibles se venden en el horario de la sede, menos lo que venga en agotados_ese_dia. " +
    "por_encargo se hacen bajo pedido (con anticipación). " +
    "Si menu_cargado=false, el equipo aún no ha cargado el menú de ese día: no prometas productos del día. " +
    "Para el precio usa cotizar_producto.",
  sensitivity: "read",
  schema,
  enabledFor: () => true, // la activación real es por workspace (tool_configs)
  run: (args: Args, ctx: ToolContext): Promise<ToolResult> =>
    callPedidosRpc("pd_consultar_disponibilidad", {
      p_ws: ctx.workspaceId,
      p_sede_codigo: args.sede,
      p_fecha: args.fecha ?? null,
      p_producto: args.producto ?? null,
    }),
};
