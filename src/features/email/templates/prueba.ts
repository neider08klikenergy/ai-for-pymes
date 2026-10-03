// Correo de prueba que una persona se envía desde Settings → Equipo.

import { appLink } from "../lib/config";
import { renderLayout, renderText, type LayoutInput } from "../lib/layout";
import { TIPO_CORREO_INFO, type TipoCorreo } from "../lib/tipos";
import type { EmailTemplate } from "./types";

export interface PruebaData {
  nombre: string | null;
  workspaceName: string;
  tipos: TipoCorreo[];
}

export const pruebaTemplate: EmailTemplate<PruebaData> = {
  id: "prueba",
  render(d, ctx) {
    const lista = d.tipos.length
      ? d.tipos.map((t) => `• ${TIPO_CORREO_INFO[t].label}`).join("\n")
      : "Aún no elegiste ningún tipo de aviso.";
    const layout: LayoutInput = {
      brand: ctx.brand,
      preheader: "Los avisos por correo funcionan.",
      eyebrow: d.workspaceName,
      title: `Hola${d.nombre ? ` ${d.nombre}` : ""}, los correos funcionan`,
      paragraphs: [
        `Este es un correo de prueba de ${ctx.brand.name}. Así te llegarán los avisos de ${d.workspaceName}.`,
        `Avisos que elegiste:\n${lista}`,
      ],
      cta: { label: "Abrir el panel", url: appLink("/inbox", ctx.brand.appUrl) },
      unsubscribeUrl: ctx.unsubscribeUrl,
      footerNote: "Lo pediste desde Configuración → Equipo.",
    };
    return {
      subject: `Correo de prueba · ${d.workspaceName}`.slice(0, 150),
      html: renderLayout(layout),
      text: renderText(layout),
    };
  },
};
