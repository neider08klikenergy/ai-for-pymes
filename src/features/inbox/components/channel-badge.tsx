import { cn } from "@/lib/utils";
import { Camera, MessageCircle, Users } from "lucide-react";

// Canal de una conversación (WhatsApp, Instagram o Facebook Messenger).
// Íconos genéricos a propósito: no se reproducen los logos de las marcas.

export type Channel = "whatsapp" | "instagram" | "facebook";

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

const CHANNEL_STYLE: Record<
  Channel,
  { Icon: React.ElementType; clase: string }
> = {
  whatsapp: { Icon: MessageCircle, clase: "bg-success/15 text-success" },
  instagram: { Icon: Camera, clase: "bg-primary/15 text-primary" },
  facebook: { Icon: Users, clase: "bg-info/15 text-info" },
};

export function asChannel(value: unknown): Channel {
  return value === "instagram" || value === "facebook" ? value : "whatsapp";
}

/** Clave de Instagram/Facebook guardada en contacts.phone ('ig:…', 'fb:…'). */
export function isSocialKey(phone: string | null | undefined): boolean {
  return typeof phone === "string" && /^(ig|fb):/.test(phone);
}

/** Lo que se muestra en vez del teléfono: el número, o el canal si no hay. */
export function contactSubtitle(phone: string, channel?: unknown): string {
  if (!isSocialKey(phone)) return phone;
  return CHANNEL_LABEL[
    asChannel(channel ?? (phone.startsWith("ig:") ? "instagram" : "facebook"))
  ];
}

export function ChannelBadge({
  channel,
  withLabel = false,
  className,
}: {
  channel: unknown;
  withLabel?: boolean;
  className?: string;
}) {
  const c = asChannel(channel);
  const { Icon, clase } = CHANNEL_STYLE[c];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        clase,
        className,
      )}
      title={CHANNEL_LABEL[c]}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {withLabel ? (
        CHANNEL_LABEL[c]
      ) : (
        <span className="sr-only">{CHANNEL_LABEL[c]}</span>
      )}
    </span>
  );
}
