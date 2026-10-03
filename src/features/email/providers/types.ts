// Contrato de un proveedor de correo. El resto del módulo no sabe cuál se usa:
// cambiar de SendGrid a Resend (u otro) es escribir un archivo con esta forma.

export interface OutgoingEmail {
  to: string;
  toName?: string | null;
  from: string;
  fromName: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  /** Enlace de baja: se envía también como cabecera List-Unsubscribe. */
  unsubscribeUrl?: string | null;
  /** Etiqueta para filtrar en el panel del proveedor (p. ej. "notificacion"). */
  category: string;
  /** Datos propios que el proveedor devuelve en sus eventos. */
  metadata?: Record<string, string>;
}

export interface EmailProvider {
  id: "sendgrid" | "resend" | "log";
  send(email: OutgoingEmail): Promise<{ id: string | null }>;
}

/** Error del proveedor: el detalle va al log y al registro, nunca al usuario. */
export class EmailProviderError extends Error {
  readonly provider: string;
  readonly status: number | null;

  constructor(provider: string, status: number | null, message: string) {
    super(message);
    this.name = "EmailProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export function listUnsubscribeHeaders(url: string | null | undefined): Record<string, string> {
  return url
    ? { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    : {};
}

export const EMAIL_TIMEOUT_MS = 15_000;
