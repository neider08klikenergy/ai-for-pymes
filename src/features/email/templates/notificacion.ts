// Un aviso de la campana (pedido nuevo, comprobante, traspaso…) por correo.

import { appLink } from "../lib/config";
import { renderLayout, renderText, type LayoutInput } from "../lib/layout";
import { TIPO_CORREO_INFO, type TipoCorreo } from "../lib/tipos";
import type { EmailTemplate } from "./types";

export interface NotificacionData {
  tipo: TipoCorreo;
  titulo: string;
  cuerpo: string | null;
  /** Ruta del panel (/inbox/…, /pedidos…). */
  enlace: string | null;
  workspaceName: string;
}

const TEXTO: Record<TipoCorreo, { intro: string; boton: string }> = {
  pedido_nuevo: {
    intro: "El agente registró un pedido nuevo.",
    boton: "Ver pedidos",
  },
  pago_por_verificar: {
    intro: "Un cliente envió un comprobante. Revísalo para confirmar el pago.",
    boton: "Verificar pago",
  },
  handoff: {
    intro: "La IA pasó esta conversación a tu equipo. El cliente espera respuesta de una persona.",
    boton: "Abrir conversación",
  },
  cliente_esperando: {
    intro: "Un cliente lleva varios minutos esperando respuesta del equipo.",
    boton: "Responder ahora",
  },
  ia_retomo: {
    intro: "Nadie respondió a tiempo y la IA volvió a atender esta conversación.",
    boton: "Ver conversación",
  },
};

export const notificacionTemplate: EmailTemplate<NotificacionData> = {
  id: "notificacion",
  render(d, ctx) {
    const t = TEXTO[d.tipo];
    const subject = `${d.titulo} · ${d.workspaceName}`.slice(0, 150);
    const layout: LayoutInput = {
      brand: ctx.brand,
      preheader: d.cuerpo ?? t.intro,
      eyebrow: `${d.workspaceName} · ${TIPO_CORREO_INFO[d.tipo].label}`,
      title: d.titulo,
      paragraphs: [t.intro, ...(d.cuerpo ? [d.cuerpo] : [])],
      cta: { label: t.boton, url: appLink(d.enlace, ctx.brand.appUrl) },
      unsubscribeUrl: ctx.unsubscribeUrl,
      footerNote: `Recibes este correo porque activaste los avisos por correo de ${d.workspaceName}. Puedes cambiarlos en Configuración → Equipo.`,
    };
    return { subject, html: renderLayout(layout), text: renderText(layout) };
  },
};
