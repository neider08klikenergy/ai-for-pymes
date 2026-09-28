import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { callPedidosRpc } from "./rpc";

const schema = z.object({
  sede: z.string().describe("Código de la sede, ej: caudal, buque, amarilo"),
  fecha_entrega: z
    .string()
    .describe(
      "Fecha y hora de entrega en hora local, formato YYYY-MM-DDTHH:MM (ej: 2026-10-03T15:00). Cópiala de la tabla de fechas",
    ),
  cantidad: z.number().int().min(1).max(50).optional().describe("Unidades (por defecto 1)"),
  personalizado: z
    .boolean()
    .optional()
    .describe("true para ponqués personalizados (aplica anticipación mínima); false para menú/vitrina"),
});

type Args = z.infer<typeof schema>;

export const consultarCupoTool: Tool<Args> = {
  name: "consultar_cupo",
  description:
    "Verifica si se puede entregar en esa sede, fecha y hora: anticipación mínima, horario de la sede, " +
    "si la sede hace personalizados y si queda cupo ese día. Úsala ANTES de registrar un pedido. " +
    "Si disponible=false, explica los motivos y ofrece otra fecha.",
  sensitivity: "read",
  schema,
  enabledFor: () => true,
  run: (args: Args, ctx: ToolContext): Promise<ToolResult> =>
    callPedidosRpc("pd_consultar_cupo", {
      p_ws: ctx.workspaceId,
      p_sede_codigo: args.sede,
      p_fecha_entrega: args.fecha_entrega,
      p_cantidad: args.cantidad ?? 1,
      p_personalizado: args.personalizado ?? true,
    }),
};
