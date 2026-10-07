import { z } from "zod";
import { createClient as createSbClient } from "@supabase/supabase-js";
import type { Tool, ToolContext, ToolResult } from "../../core/tool";
import { dispatchLocation, dispatchText } from "@/features/inbox/services/dispatch";
import { coordenada, textoUbicacion } from "@/features/pedidos/lib/ubicacion";
import { callPedidosRpc } from "./rpc";

// Envía la ubicación de una sede. Con coordenadas (marcadas en el mapa del
// panel): pin nativo en WhatsApp, y en Instagram/Facebook el texto con el
// enlace de Maps. Sin coordenadas: la dirección en texto.

/** La misma sede enviada hace menos de esto no se repite. */
const VENTANA_REPETIDA_MS = 15 * 60 * 1000;

const schema = z.object({
  sede: z
    .string()
    .optional()
    .describe("Código o nombre de la sede, ej: caudal, buque. Omite si el negocio tiene una sola sede"),
});

type Args = z.infer<typeof schema>;

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function enviadaHacePoco(conversationId: string, sedeCodigo: string): Promise<boolean> {
  const { data } = await svc()
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "out")
    .eq("meta->>ubicacion_sede", sedeCodigo)
    .gte("created_at", new Date(Date.now() - VENTANA_REPETIDA_MS).toISOString())
    .limit(1);
  return (data ?? []).length > 0;
}

export const enviarUbicacionSedeTool: Tool<Args> = {
  name: "enviar_ubicacion_sede",
  description:
    "Envía al cliente, por este chat, la dirección de una sede y su ubicación en el mapa (si está marcada). " +
    "Úsala cuando pregunte dónde quedan, cómo llegar o la dirección. Llega antes que tu mensaje: no repitas la dirección, " +
    "acompáñala con una frase corta (puedes agregar el horario). " +
    "Si responde ELIGE_SEDE, pregúntale al cliente cuál de las sedes le queda mejor.",
  sensitivity: "write",
  schema,
  enabledFor: () => true, // la activación real es por workspace (tool_configs)
  run: async (args: Args, ctx: ToolContext): Promise<ToolResult> => {
    const buscada = await callPedidosRpc("pd_ubicacion_sede", {
      p_ws: ctx.workspaceId,
      p_sede_codigo: args.sede ?? null,
    });
    if (!buscada.ok) return buscada;

    const u = buscada.output as {
      sede: string;
      sede_codigo: string;
      direccion: string | null;
      latitud: unknown;
      longitud: unknown;
    };
    const latitud = coordenada(u.latitud, 90);
    const longitud = coordenada(u.longitud, 180);
    const conPin = latitud !== null && longitud !== null;

    if (await enviadaHacePoco(ctx.conversationId, u.sede_codigo)) {
      return {
        ok: true,
        output: { sede: u.sede, enviada: false, guia: "Esa ubicación ya se le envió hace un momento: no la repitas." },
      };
    }

    const texto = textoUbicacion({ sede: u.sede, direccion: u.direccion, latitud, longitud });
    const meta = { ubicacion_sede: u.sede_codigo };
    const r = conPin
      ? await dispatchLocation({
          workspaceId: ctx.workspaceId,
          conversationId: ctx.conversationId,
          latitude: latitud,
          longitude: longitud,
          name: u.sede,
          address: u.direccion ?? undefined,
          text: texto,
          meta,
        })
      : await dispatchText({
          workspaceId: ctx.workspaceId,
          conversationId: ctx.conversationId,
          body: texto,
          meta,
        });

    if (!r.ok) {
      console.error("[enviar_ubicacion_sede] dispatch failed:", r.errorCode, r.error);
      return {
        ok: false,
        output: {
          error: "NO_SE_PUDO_ENVIAR",
          // Plan B: el agente escribe la dirección en su respuesta
          direccion: u.direccion,
          guia: "No se pudo enviar la ubicación. Escribe la dirección en tu respuesta.",
        },
        error: "NO_SE_PUDO_ENVIAR",
      };
    }

    return {
      ok: true,
      output: {
        sede: u.sede,
        enviada: true,
        con_mapa: conPin,
        guia: "La ubicación ya le llegó al cliente. Responde con una frase corta, sin repetir la dirección.",
      },
    };
  },
};
