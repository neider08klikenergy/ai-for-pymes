// SendGrid (API v3, /mail/send). Responde 202 y el id en la cabecera X-Message-Id.

import {
  EMAIL_TIMEOUT_MS,
  EmailProviderError,
  listUnsubscribeHeaders,
  type EmailProvider,
} from "./types";

const URL_SEND = "https://api.sendgrid.com/v3/mail/send";

export function sendgridProvider(apiKey: string): EmailProvider {
  return {
    id: "sendgrid",
    async send(e) {
      const res = await fetch(URL_SEND, {
        method: "POST",
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: e.to, ...(e.toName ? { name: e.toName } : {}) }] }],
          from: { email: e.from, name: e.fromName },
          ...(e.replyTo ? { reply_to: { email: e.replyTo } } : {}),
          subject: e.subject,
          content: [
            { type: "text/plain", value: e.text },
            { type: "text/html", value: e.html },
          ],
          headers: listUnsubscribeHeaders(e.unsubscribeUrl),
          categories: [e.category],
          ...(e.metadata ? { custom_args: e.metadata } : {}),
          // Sin reescritura de enlaces: el de baja y los del panel quedan tal cual.
          tracking_settings: { click_tracking: { enable: false, enable_text: false } },
        }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new EmailProviderError("sendgrid", res.status, `SendGrid ${res.status}: ${detail}`);
      }
      return { id: res.headers.get("x-message-id") };
    },
  };
}
