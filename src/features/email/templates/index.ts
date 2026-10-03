// Registro de plantillas. Para agregar un correo nuevo: crea su archivo en
// esta carpeta (datos tipados → asunto/HTML/texto) y súmalo aquí.

import { notificacionTemplate, type NotificacionData } from "./notificacion";
import { pruebaTemplate, type PruebaData } from "./prueba";

export interface EmailTemplateData {
  notificacion: NotificacionData;
  prueba: PruebaData;
}

export type EmailTemplateId = keyof EmailTemplateData;

export const EMAIL_TEMPLATES = {
  notificacion: notificacionTemplate,
  prueba: pruebaTemplate,
} as const;

export type { RenderedEmail, TemplateContext, EmailTemplate } from "./types";
