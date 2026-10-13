// PQRS: tipos, estados y validación compartidos por el formulario del panel,
// la ruta que las guarda y el panel de agencia.

import { z } from "zod";

export const TIPOS_PQRS = ["peticion", "queja", "reclamo", "sugerencia", "falla"] as const;
export type TipoPqrs = (typeof TIPOS_PQRS)[number];

export const ESTADOS_PQRS = ["abierta", "en_progreso", "resuelta", "descartada"] as const;
export type EstadoPqrs = (typeof ESTADOS_PQRS)[number];

export const TIPO_PQRS_LABEL: Record<TipoPqrs, string> = {
  peticion: "Petición",
  queja: "Queja",
  reclamo: "Reclamo",
  sugerencia: "Sugerencia",
  falla: "Falla de la plataforma",
};

export const ESTADO_PQRS_LABEL: Record<EstadoPqrs, string> = {
  abierta: "Abierta",
  en_progreso: "En progreso",
  resuelta: "Resuelta",
  descartada: "Descartada",
};

/** PQRS por persona en una hora: frena el spam, no a un admin con varios reportes. */
export const MAX_PQRS_POR_HORA = 10;

export const PqrsSchema = z.object({
  workspaceId: z.string().uuid(),
  tipo: z.enum(TIPOS_PQRS, { message: "Elige el tipo" }),
  asunto: z.string().trim().min(3, "Escribe un asunto").max(150, "El asunto pasa de 150 caracteres"),
  descripcion: z
    .string()
    .trim()
    .min(10, "Cuéntanos un poco más (mínimo 10 caracteres)")
    .max(4000, "La descripción pasa de 4.000 caracteres"),
  pagina: z.string().max(300).optional(),
});
