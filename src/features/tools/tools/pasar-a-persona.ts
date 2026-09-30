import { z } from "zod";
import type { Tool, ToolResult } from "../core/tool";

// Pasa la conversación al equipo DESPUÉS de que el agente responda.
//
// No cambia el estado aquí: si la conversación saliera de ai_active a mitad
// del turno, el buffer no enviaría la respuesta ("dame un momento…"). El
// buffer lee el motivo cuando la herramienta termina, lo guarda en el lote y
// hace el handoff justo después de entregar la respuesta (buffer.ts).

export const PASAR_A_PERSONA = "pasar_a_persona";

const schema = z.object({
  motivo: z
    .string()
    .min(3)
    .max(300)
    .describe(
      "Qué necesita el equipo, corto y concreto. Ej: 'Cotizar domicilio a Cra 30 #12-10, Barzal (pedido Red Velvet 1 lb)'",
    ),
});

type Args = z.infer<typeof schema>;

/** Motivo que devolvió la herramienta (o null si la salida no lo trae). */
export function motivoDePasarAPersona(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const motivo = (output as { motivo?: unknown }).motivo;
  return typeof motivo === "string" && motivo.trim() ? motivo.trim().slice(0, 300) : null;
}

export const pasarAPersonaTool: Tool<Args> = {
  name: PASAR_A_PERSONA,
  description:
    "Pasa la conversación a una persona del equipo cuando necesitas algo que no puedes resolver (ej: el valor " +
    "de un domicilio sin tarifa, una queja, un caso especial). En el mismo turno dile al cliente que una persona " +
    "le responde en un momento. La conversación pasa al equipo justo después de tu respuesta.",
  sensitivity: "read",
  schema,
  enabledFor: () => true,
  run: async (args: Args): Promise<ToolResult> => ({
    ok: true,
    output: {
      ok: true,
      motivo: args.motivo.trim(),
      nota: "Después de tu respuesta la conversación pasa al equipo. Dile al cliente que una persona le responde en un momento.",
    },
  }),
};
