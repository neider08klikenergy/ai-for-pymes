import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { callPedidosRpc } from "./rpc";

const schema = z.object({
  linea: z
    .string()
    .describe(
      "Producto (su código o nombre en el catálogo), ej: ponque_personalizado, porcion, largo, golovesa, golotarta, helado",
    ),
  sabor: z
    .string()
    .optional()
    .describe("Sabor exacto, ej: Red Velvet, ChocoBerry. Omite si el producto no tiene sabor"),
  tamano: z.string().describe("Tamaño exacto, ej: 1/4 lb, 1/2 lb, 1 lb, personal, porcion"),
  cantidad: z.number().int().min(1).max(50).optional().describe("Unidades (por defecto 1)"),
  valor_domicilio: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Solo si es domicilio y ya tienes el valor (de cotizar_domicilio o de una persona del equipo). Devuelve el total y las formas de pago con domicilio",
    ),
});

type Args = z.infer<typeof schema>;

export const cotizarProductoTool: Tool<Args> = {
  name: "cotizar_producto",
  description:
    "Obtiene el PRECIO OFICIAL, el anticipo y el saldo de un producto desde el catálogo. " +
    "Úsala SIEMPRE antes de decir un precio; nunca calcules ni inventes precios. " +
    "Si es domicilio, pásale valor_domicilio para obtener el total y las formas de pago (no los sumes tú). " +
    "Si responde PRECIO_NO_ENCONTRADO, ofrece las opciones que devuelve.",
  sensitivity: "read",
  schema,
  enabledFor: () => true, // la activación real es por workspace (tool_configs)
  run: async (args: Args, ctx: ToolContext): Promise<ToolResult> => {
    const result = await callPedidosRpc("pd_cotizar", {
      p_ws: ctx.workspaceId,
      p_linea: args.linea,
      p_sabor: args.sabor ?? null,
      p_tamano: args.tamano,
      p_cantidad: args.cantidad ?? 1,
    });
    if (!result.ok || args.valor_domicilio === undefined) return result;
    return { ...result, output: conDomicilio(result.output, args.valor_domicilio) };
  },
};

/**
 * Suma el domicilio a la cotización (aquí, no el modelo). El anticipo mínimo
 * sigue siendo sobre el producto; el domicilio se paga con el saldo.
 */
export function conDomicilio(output: unknown, valorDomicilio: number): unknown {
  const cot = output as { total?: unknown; anticipo?: unknown } | null;
  if (!cot || typeof cot.total !== "number" || typeof cot.anticipo !== "number") return output;
  const total = cot.total + valorDomicilio;
  return {
    ...cot,
    subtotal_producto: cot.total,
    valor_domicilio: valorDomicilio,
    total_con_domicilio: total,
    formas_de_pago: {
      todo: total,
      solo_producto: cot.total,
      anticipo_minimo: cot.anticipo,
    },
    saldo_si_paga_anticipo: total - cot.anticipo,
    saldo_si_paga_producto: valorDomicilio,
  };
}
