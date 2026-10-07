// Solicitudes de demo de Felrick: validación, textos y Cal.com.
// La página pública /demo guarda la solicitud y luego muestra el calendario
// de Cal.com con los datos precargados. Las gestiona el equipo de Felrick en
// el panel de agencia → Solicitudes.

import { z } from "zod";

export const CANALES = ["whatsapp", "instagram", "facebook"] as const;
export type Canal = (typeof CANALES)[number];
export const CANAL_LABEL: Record<Canal, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

export const MENSAJES_DIA = ["<20", "20-100", "100-500", ">500"] as const;
export const MENSAJES_LABEL: Record<(typeof MENSAJES_DIA)[number], string> = {
  "<20": "Menos de 20",
  "20-100": "Entre 20 y 100",
  "100-500": "Entre 100 y 500",
  ">500": "Más de 500",
};

export const ESTADOS = ["nueva", "contactada", "agendada", "demo_hecha", "cliente", "descartada"] as const;
export type EstadoSolicitud = (typeof ESTADOS)[number];
export const ESTADO_LABEL: Record<EstadoSolicitud, string> = {
  nueva: "Nueva",
  contactada: "Contactada",
  agendada: "Demo agendada",
  demo_hecha: "Demo hecha",
  cliente: "Cliente",
  descartada: "Descartada",
};

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const SolicitudSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre").max(120),
  empresa: z.string().trim().min(2, "Escribe el nombre de tu negocio").max(120),
  correo: z.string().trim().toLowerCase().email("Escribe un correo válido").max(200),
  whatsapp: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{7,20}$/, "Escribe un número de WhatsApp válido"),
  sector: textoOpcional(80),
  ciudad: textoOpcional(80),
  sedes: z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(1, "Mínimo 1 sede").max(1000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  canales: z.array(z.enum(CANALES)).max(3).default([]),
  usa_shopify: z.boolean().nullable().optional().transform((v) => v ?? null),
  mensajes_dia: z
    .union([z.enum(MENSAJES_DIA), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  comentario: textoOpcional(1000),
  // Trampa para bots: un campo oculto que una persona nunca llena
  sitio_web: z.string().max(200).optional(),
});

export type SolicitudInput = z.input<typeof SolicitudSchema>;
export type SolicitudDatos = z.output<typeof SolicitudSchema>;

export function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos no válidos";
}

/**
 * Enlace de Cal.com configurado (NEXT_PUBLIC_CALCOM_LINK). Acepta
 * "felrick/demo" o la URL completa "https://cal.com/felrick/demo".
 * null si aún no hay cuenta de Cal.com.
 */
export function calLinkDe(valor: string | undefined): string | null {
  const v = valor?.trim();
  if (!v) return null;
  const sinOrigen = v.replace(/^https?:\/\/(app\.)?cal\.com\//i, "").replace(/^\/+|\/+$/g, "");
  return /^[\w.-]+(\/[\w.-]+)*$/.test(sinOrigen) ? sinOrigen : null;
}

/** Notas que van precargadas en la reserva de Cal.com (las ve el equipo). */
export function notasParaCalcom(s: SolicitudDatos): string {
  return [
    `Empresa: ${s.empresa}`,
    s.sector && `Sector: ${s.sector}`,
    s.ciudad && `Ciudad: ${s.ciudad}`,
    s.sedes && `Sedes: ${s.sedes}`,
    s.canales.length > 0 && `Canales: ${s.canales.map((c) => CANAL_LABEL[c]).join(", ")}`,
    s.usa_shopify !== null && `Shopify: ${s.usa_shopify ? "sí" : "no"}`,
    s.mensajes_dia && `Mensajes al día: ${MENSAJES_LABEL[s.mensajes_dia]}`,
    `WhatsApp: ${s.whatsapp}`,
    s.comentario && `Comentario: ${s.comentario}`,
  ]
    .filter(Boolean)
    .join("\n");
}
