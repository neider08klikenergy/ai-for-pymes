// Perfil de la plataforma: contacto de soporte que ven los workspaces.

import { z } from "zod";

export interface ContactoSoporte {
  email: string | null;
  whatsapp: string[];
}

export const MAX_WHATSAPP_SOPORTE = 5;

/** Formato internacional: + y 8 a 15 dígitos (se guarda sin espacios). */
const WHATSAPP = /^\+\d{8,15}$/;

export const PerfilSchema = z.object({
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .pipe(z.string().email("El correo no es válido").nullable()),
  // Uno por línea (o separados por coma); se ignoran espacios y guiones.
  whatsapp: z
    .string()
    .transform((v) =>
      v
        .split(/[\n,]/)
        .map((n) => n.replace(/[\s()-]/g, ""))
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().regex(WHATSAPP, "Escribe cada número con + y el indicativo, por ejemplo +573001234567"))
        .max(MAX_WHATSAPP_SOPORTE, `Máximo ${MAX_WHATSAPP_SOPORTE} números`),
    ),
});

/** Enlace de WhatsApp para un número guardado (+573001234567 → wa.me/573001234567). */
export function enlaceWhatsapp(numero: string): string {
  return `https://wa.me/${numero.replace(/\D/g, "")}`;
}
