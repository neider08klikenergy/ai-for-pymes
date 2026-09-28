import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { callPedidosRpc } from "./rpc";

const schema = z.object({
  linea: z
    .string()
    .describe(
      "Línea del producto tal como está en el tarifario, ej: ponque_personalizado, porcion, largo, golovesa, golotarta, helado",
    ),
  sabor: z
    .string()
    .optional()
    .describe("Sabor exacto, ej: Red Velvet, ChocoBerry. Omite si el producto no tiene sabor"),
  tamano: z.string().describe("Tamaño exacto, ej: 1/4 lb, 1/2 lb, 1 lb, personal, porcion"),
  cantidad: z.number().int().min(1).max(50).optional().describe("Unidades (por defecto 1)"),
});

type Args = z.infer<typeof schema>;

export const cotizarProductoTool: Tool<Args> = {
  name: "cotizar_producto",
  description:
    "Obtiene el PRECIO OFICIAL, el anticipo y el saldo de un producto desde el tarifario. " +
    "Úsala SIEMPRE antes de decir un precio; nunca calcules ni inventes precios. " +
    "Si responde PRECIO_NO_ENCONTRADO, ofrece las opciones que devuelve.",
  sensitivity: "read",
  schema,
  enabledFor: () => true, // la activación real es por workspace (tool_configs)
  run: (args: Args, ctx: ToolContext): Promise<ToolResult> =>
    callPedidosRpc("pd_cotizar", {
      p_ws: ctx.workspaceId,
      p_linea: args.linea,
      p_sabor: args.sabor ?? null,
      p_tamano: args.tamano,
      p_cantidad: args.cantidad ?? 1,
    }),
};
