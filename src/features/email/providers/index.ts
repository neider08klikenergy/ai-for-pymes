// Elige el proveedor con EMAIL_PROVIDER (sendgrid | resend | log). Sin esa
// variable usa el primero que tenga API key; sin ninguna, "log": no envía,
// solo lo escribe en la consola (desarrollo local).

import { resendProvider } from "./resend";
import { sendgridProvider } from "./sendgrid";
import type { EmailProvider } from "./types";

const logProvider: EmailProvider = {
  id: "log",
  async send(e) {
    console.info(`[email:log] → ${e.to} · ${e.subject}`);
    return { id: null };
  },
};

export function getEmailProvider(): EmailProvider {
  const wanted = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const sendgridKey = process.env.SENDGRID_API_KEY?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();

  if (wanted === "log") return logProvider;
  if (wanted === "sendgrid") {
    if (!sendgridKey) throw new Error("EMAIL_PROVIDER=sendgrid pero falta SENDGRID_API_KEY");
    return sendgridProvider(sendgridKey);
  }
  if (wanted === "resend") {
    if (!resendKey) throw new Error("EMAIL_PROVIDER=resend pero falta RESEND_API_KEY");
    return resendProvider(resendKey);
  }
  if (sendgridKey) return sendgridProvider(sendgridKey);
  if (resendKey) return resendProvider(resendKey);
  return logProvider;
}

export type { EmailProvider, OutgoingEmail } from "./types";
export { EmailProviderError } from "./types";
