// Invitación a una cuenta nueva: la persona abre el enlace (de un solo uso) y
// elige su contraseña. Nadie más la conoce.

import type { EmailTemplate } from "./types";
import { renderLayout, renderText, type LayoutInput } from "../lib/layout";

export interface InvitacionData {
  workspaceName: string;
  /** Enlace de un solo uso a /auth/confirmar. */
  url: string;
}

export const invitacionTemplate: EmailTemplate<InvitacionData> = {
  id: "invitacion",
  render(d, ctx) {
    const layout: LayoutInput = {
      brand: ctx.brand,
      preheader: `Te invitaron a ${d.workspaceName}. Elige tu contraseña para entrar.`,
      eyebrow: d.workspaceName,
      title: `Te invitaron a ${d.workspaceName}`,
      paragraphs: [
        `Te dieron acceso al panel de ${d.workspaceName} en ${ctx.brand.name}. Para entrar, abre el enlace y elige tu contraseña: solo tú la vas a conocer.`,
        "El enlace sirve una sola vez y vence en unas horas. Si venció, pide que te inviten de nuevo.",
      ],
      cta: { label: "Elegir mi contraseña", url: d.url },
      unsubscribeUrl: null,
      footerNote:
        "Si no esperabas esta invitación, ignora este correo: sin abrir el enlace no se activa nada.",
    };
    return {
      subject: `Te invitaron a ${d.workspaceName} · ${ctx.brand.name}`.slice(
        0,
        150,
      ),
      html: renderLayout(layout),
      text: renderText(layout),
    };
  },
};
