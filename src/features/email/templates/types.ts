import type { EmailBrand } from "../lib/config";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateContext {
  brand: EmailBrand;
  /** Enlace de baja del destinatario; null si no aplica. */
  unsubscribeUrl: string | null;
}

/** Una plantilla: datos tipados → asunto, HTML y texto. Sin efectos. */
export interface EmailTemplate<Data> {
  id: string;
  render(data: Data, ctx: TemplateContext): RenderedEmail;
}
