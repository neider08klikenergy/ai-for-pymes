// Provider-neutral send surface. dispatch.ts (the SEC-04 single exit point)
// asks for a sender for the workspace's active WhatsApp integration and never
// names a provider: YCloud addresses the sender by its E.164 number, Kapso by
// Meta's phone_number_id in the request path.

import * as ycloud from "./ycloud-client";
import * as kapso from "./kapso-client";
import * as zernio from "./zernio-client";
import {
  WHATSAPP_PROVIDER_LABELS,
  whatsappApiKey,
  type WhatsAppProvider,
} from "./whatsapp-provider";

/** FLAT parameters per component (both providers take Meta's shape). */
export type TemplateComponents = NonNullable<ycloud.TemplateParams["components"]>;

/**
 * A quién le escribimos, más allá del teléfono. Zernio envía por conversación
 * (y es el único camino en Instagram y Facebook, donde no hay teléfono).
 */
export interface SendTarget {
  channel: string;
  externalConversationId: string | null;
  externalAccountId: string | null;
}

export interface SendResult {
  /** WhatsApp message id — synchronous on Kapso, may arrive later on YCloud */
  wamid?: string;
  /** The provider's own message id (YCloud only), for status reconciliation */
  providerMessageId?: string;
  /** Zernio: conversación creada al escribir por primera vez a un número. */
  externalConversationId?: string;
}

export interface WhatsAppSender {
  provider: WhatsAppProvider;
  label: string;
  /** False for a missing/"placeholder" key: dev mode, nothing is sent. */
  live: boolean;
  sendText(to: string, body: string, target?: SendTarget): Promise<SendResult>;
  sendTemplate(params: {
    to: string;
    templateName: string;
    language?: string;
    components?: TemplateComponents;
    target?: SendTarget;
  }): Promise<SendResult>;
}

/**
 * A setting the workspace is missing, named in Spanish for the team. dispatch
 * shows this message as is: unlike a provider error, it carries no remote text.
 */
export class WhatsAppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppConfigError";
  }
}

/**
 * Without the id it sends from, the provider API answers with an opaque error
 * (Kapso even gets an empty path segment). Name the missing setting instead:
 * dispatch stores this message on the failed outbound, where the team sees it.
 */
function requireSenderId(value: string, what: string, label: string): string {
  if (!value.trim()) {
    throw new WhatsAppConfigError(
      `Falta ${what} de ${label}: complétalo en Configuración → Integraciones → WhatsApp`,
    );
  }
  return value;
}

export function whatsappSender(
  provider: WhatsAppProvider,
  credentials: Record<string, unknown>,
  config: Record<string, unknown>,
): WhatsAppSender {
  const apiKey = whatsappApiKey(provider, credentials);
  const live = Boolean(apiKey && apiKey !== "placeholder");
  const label = WHATSAPP_PROVIDER_LABELS[provider];

  if (provider === "zernio") return zernioSender(config, live, label);

  if (provider === "kapso") {
    const configured = (config.phone_number_id as string | undefined) ?? "";
    const phoneNumberId = () =>
      requireSenderId(configured, "el Phone Number ID", label);
    return {
      provider,
      label,
      live,
      async sendText(to, body) {
        const sent = await kapso.sendText({
          apiKey,
          phoneNumberId: phoneNumberId(),
          to,
          body,
        });
        return { wamid: sent.wamid || undefined };
      },
      async sendTemplate({ to, templateName, language, components }) {
        const sent = await kapso.sendTemplate({
          apiKey,
          phoneNumberId: phoneNumberId(),
          to,
          templateName,
          language,
          components,
        });
        return { wamid: sent.wamid || undefined };
      },
    };
  }

  const configured = (config.phone_number as string | undefined) ?? "";
  const from = () => requireSenderId(configured, "el número de WhatsApp", label);
  return {
    provider,
    label,
    live,
    async sendText(to, body) {
      const sent = await ycloud.sendText({ apiKey, from: from(), to, body });
      return {
        wamid: sent.wamid || undefined,
        providerMessageId: sent.id || undefined,
      };
    },
    async sendTemplate({ to, templateName, language, components }) {
      const sent = await ycloud.sendTemplate({
        apiKey,
        from: from(),
        to,
        templateName,
        language,
        components,
      });
      return {
        wamid: sent.wamid || undefined,
        providerMessageId: sent.id || undefined,
      };
    },
  };
}

// ── Zernio (WhatsApp + Instagram + Facebook) ─────────────────────────────────

interface ZernioAccountConfig {
  id?: unknown;
  platform?: unknown;
}

/** La cuenta de WhatsApp conectada al perfil del workspace, si hay. */
function zernioWhatsAppAccount(config: Record<string, unknown>): string | null {
  const accounts = Array.isArray(config.accounts) ? (config.accounts as ZernioAccountConfig[]) : [];
  const wa = accounts.find((a) => a.platform === "whatsapp" && typeof a.id === "string");
  return wa ? (wa.id as string) : null;
}

/** Los textos de los parámetros del cuerpo, en orden ({{1}}, {{2}}…). */
function bodyParams(components: TemplateComponents | undefined): string[] {
  const body = (components ?? []).find(
    (c) => String((c as { type?: unknown }).type).toLowerCase() === "body",
  ) as { parameters?: Array<{ text?: unknown }> } | undefined;
  return (body?.parameters ?? []).map((p) => (typeof p.text === "string" ? p.text : ""));
}

function zernioSender(
  config: Record<string, unknown>,
  live: boolean,
  label: string,
): WhatsAppSender {
  function accountFor(target: SendTarget | undefined): string {
    const account =
      target?.externalAccountId ??
      (!target || target.channel === "whatsapp" ? zernioWhatsAppAccount(config) : null);
    if (!account) {
      throw new WhatsAppConfigError(
        target && target.channel !== "whatsapp"
          ? `Esta conversación de ${target.channel === "instagram" ? "Instagram" : "Facebook"} no tiene la cuenta de ${label}: espera a que el cliente vuelva a escribir`
          : `Conecta WhatsApp en ${label}: Configuración → Integraciones → WhatsApp`,
      );
    }
    return account;
  }

  return {
    provider: "zernio",
    label,
    live,
    async sendText(to, body, target) {
      const accountId = accountFor(target);
      if (target?.externalConversationId) {
        const sent = await zernio.sendMessage({
          conversationId: target.externalConversationId,
          accountId,
          text: body,
        });
        return { wamid: sent.messageId ?? undefined };
      }
      if (target && target.channel !== "whatsapp") {
        throw new WhatsAppConfigError(
          "Esta conversación no tiene el id de Zernio: espera a que el cliente vuelva a escribir",
        );
      }
      const sent = await zernio.startWhatsAppConversation({ accountId, phone: to, text: body });
      return {
        wamid: sent.messageId ?? undefined,
        externalConversationId: sent.conversationId ?? undefined,
      };
    },
    async sendTemplate({ to, templateName, language, components, target }) {
      if (target && target.channel !== "whatsapp") {
        throw new WhatsAppConfigError(
          "Instagram y Facebook no tienen plantillas: el cliente debe escribir primero",
        );
      }
      const accountId = accountFor(target);
      if (target?.externalConversationId) {
        const sent = await zernio.sendMessage({
          conversationId: target.externalConversationId,
          accountId,
          template: {
            name: templateName,
            language: language ?? "es",
            ...(components?.length ? { components: components as unknown[] } : {}),
          },
        });
        return { wamid: sent.messageId ?? undefined };
      }
      const sent = await zernio.startWhatsAppConversation({
        accountId,
        phone: to,
        templateName,
        templateLanguage: language ?? "es",
        templateParams: bodyParams(components),
      });
      return {
        wamid: sent.messageId ?? undefined,
        externalConversationId: sent.conversationId ?? undefined,
      };
    },
  };
}
