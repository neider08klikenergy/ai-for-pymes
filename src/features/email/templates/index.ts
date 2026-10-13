// Registro de plantillas. Para agregar un correo nuevo: crea su archivo en
// esta carpeta (datos tipados → asunto/HTML/texto) y súmalo aquí.

import { notificacionTemplate, type NotificacionData } from "./notificacion";
import { pruebaTemplate, type PruebaData } from "./prueba";
import { invitacionTemplate, type InvitacionData } from "./invitacion";

export interface EmailTemplateData {
  notificacion: NotificacionData;
  prueba: PruebaData;
  invitacion: InvitacionData;
}

export type EmailTemplateId = keyof EmailTemplateData;

export const EMAIL_TEMPLATES = {
  notificacion: notificacionTemplate,
  prueba: pruebaTemplate,
  invitacion: invitacionTemplate,
} as const;

export type { RenderedEmail, TemplateContext, EmailTemplate } from "./types";
