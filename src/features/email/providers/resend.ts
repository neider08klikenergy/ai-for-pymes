// Resend (POST /emails). Alternativa con plan gratuito al mismo contrato.

import {
  EMAIL_TIMEOUT_MS,
  EmailProviderError,
  listUnsubscribeHeaders,
  type EmailProvider,
} from "./types";

const URL_SEND = "https://api.resend.com/emails";

/** Resend solo acepta letras, números, _ y - en las etiquetas. */
function tagValue(v: string): string {
  return v.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}

export function resendProvider(apiKey: string): EmailProvider {
  return {
    id: "resend",
    async send(e) {
      const res = await fetch(URL_SEND, {
        method: "POST",
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${e.fromName.replace(/[<>"]/g, "")} <${e.from}>`,
          to: [e.to],
          ...(e.replyTo ? { reply_to: e.replyTo } : {}),
          subject: e.subject,
          html: e.html,
          text: e.text,
          headers: listUnsubscribeHeaders(e.unsubscribeUrl),
          tags: [
            { name: "category", value: tagValue(e.category) },
            ...Object.entries(e.metadata ?? {}).map(([name, value]) => ({
              name: tagValue(name),
              value: tagValue(value),
            })),
          ],
        }),
      });
      const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
      if (!res.ok) {
        const detail = typeof body?.message === "string" ? body.message : "";
        throw new EmailProviderError("resend", res.status, `Resend ${res.status}: ${detail}`.slice(0, 300));
      }
      return { id: typeof body?.id === "string" ? body.id : null };
    },
  };
}
