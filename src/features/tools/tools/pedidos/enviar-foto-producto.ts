import { z } from "zod";
import { createClient as createSbClient } from "@supabase/supabase-js";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { dispatchImage } from "@/features/inbox/services/dispatch";
import { callPedidosRpc } from "./rpc";

// Envía al cliente la foto de un producto de vitrina (modo 'siempre' o
// 'por_dia'). Los productos por encargo (personalizados) los rechaza
// pd_foto_producto: esas fotos las comparte una persona del equipo.
// La foto sale por su URL pública (bucket productos-imagenes o enlace
// externo): el proveedor de WhatsApp la descarga, nuestro servidor no.

/** Una foto ya enviada en esta conversación hace menos de esto no se repite. */
const VENTANA_REPETIDA_MS = 15 * 60 * 1000;

const schema = z.object({
  producto: z
    .string()
    .min(1)
    .describe("Producto del catálogo (su código o nombre), ej: golovesa, golotarta, ponqué largo"),
  cantidad: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .describe("Cuántas fotos enviar si el producto tiene varias (por defecto 1, máximo 3)"),
});

type Args = z.infer<typeof schema>;

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Fotos de esta lista que ya se enviaron en la conversación hace poco. */
async function yaEnviadas(conversationId: string, urls: string[]): Promise<Set<string>> {
  const { data } = await svc()
    .from("messages")
    .select("meta")
    .eq("conversation_id", conversationId)
    .eq("direction", "out")
    .eq("type", "image")
    .gte("created_at", new Date(Date.now() - VENTANA_REPETIDA_MS).toISOString());
  const enviadas = new Set<string>();
  for (const row of data ?? []) {
    const url = (row.meta as { image_url?: unknown } | null)?.image_url;
    if (typeof url === "string" && urls.includes(url)) enviadas.add(url);
  }
  return enviadas;
}

export const enviarFotoProductoTool: Tool<Args> = {
  name: "enviar_foto_producto",
  description:
    "Envía al cliente, por este chat, la FOTO de un producto de vitrina (menú del día o siempre disponible). " +
    "Úsala solo cuando el cliente pida ver el producto. La foto llega antes que tu mensaje: no digas que la vas a enviar, " +
    "acompáñala con una frase corta. " +
    "Si responde PRODUCTO_POR_ENCARGO (ponqués personalizados y diseños), las fotos las comparte una persona: " +
    "dile al cliente que en un momento se las envían y llama pasar_a_persona.",
  sensitivity: "write",
  schema,
  enabledFor: () => true, // la activación real es por workspace (tool_configs)
  run: async (args: Args, ctx: ToolContext): Promise<ToolResult> => {
    const buscada = await callPedidosRpc("pd_foto_producto", {
      p_ws: ctx.workspaceId,
      p_producto: args.producto,
    });
    if (!buscada.ok) return buscada;

    const foto = buscada.output as { producto?: string; imagenes?: unknown };
    const imagenes = (Array.isArray(foto.imagenes) ? foto.imagenes : [])
      .filter((u): u is string => typeof u === "string")
      .slice(0, args.cantidad ?? 1);
    if (imagenes.length === 0) {
      return {
        ok: false,
        output: {
          error: "SIN_FOTO",
          producto: foto.producto,
          guia: "Ese producto no tiene una foto que se pueda enviar. Descríbelo y, si el cliente la quiere, pasa a una persona.",
        },
        error: "SIN_FOTO",
      };
    }

    const repetidas = await yaEnviadas(ctx.conversationId, imagenes);
    const pendientes = imagenes.filter((u) => !repetidas.has(u));
    if (pendientes.length === 0) {
      return {
        ok: true,
        output: {
          producto: foto.producto,
          enviadas: 0,
          guia: "Esa foto ya se le envió al cliente hace un momento: no la repitas.",
        },
      };
    }

    let enviadas = 0;
    for (const [i, url] of pendientes.entries()) {
      const r = await dispatchImage({
        workspaceId: ctx.workspaceId,
        conversationId: ctx.conversationId,
        imageUrl: url,
        caption: i === 0 ? foto.producto : undefined,
      });
      if (!r.ok) {
        console.error("[enviar_foto_producto] dispatch failed:", r.errorCode, r.error);
        if (enviadas === 0) {
          return {
            ok: false,
            output: {
              error: "NO_SE_PUDO_ENVIAR",
              guia:
                r.errorCode === "WINDOW_EXPIRED"
                  ? "Pasaron más de 24 horas desde el último mensaje del cliente: no se pueden enviar fotos. Pasa a una persona."
                  : "No se pudo enviar la foto. Dile al cliente que una persona se la comparte y llama pasar_a_persona.",
            },
            error: "NO_SE_PUDO_ENVIAR",
          };
        }
        break;
      }
      enviadas++;
    }

    return {
      ok: true,
      output: {
        producto: foto.producto,
        enviadas,
        guia: "La foto ya le llegó al cliente. Responde con una frase corta (sin repetir el enlace) y sigue la conversación.",
      },
    };
  },
};
