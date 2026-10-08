import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { MessageStatus } from "@/features/inbox/types";
import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import { GENERIC_SEND_ERROR } from "@/features/inbox/services/whatsapp-errors";

interface StatusIconProps {
  status: MessageStatus | null;
  /**
   * Spanish text ready to show (`messages.error_message`). Never pass anything
   * from `message_errors` here: the code, fbtrace_id and English detail stay on
   * the server.
   */
  errorMessage?: string | null;
}

export function StatusIcon({ status, errorMessage }: StatusIconProps) {
  const t = useTranslations("inbox.estadoMensaje");
  if (!status) return null;

  switch (status) {
    case "queued":
      return (
        <Clock
          className={cn("h-3 w-3 shrink-0 opacity-50")}
          aria-label={t("enCola")}
        />
      );
    case "sent":
      return (
        <Check
          className={cn("h-3 w-3 shrink-0 opacity-60")}
          aria-label={t("enviado")}
        />
      );
    case "delivered":
      return (
        <CheckCheck
          className={cn("h-3 w-3 shrink-0 opacity-60")}
          aria-label={t("entregado")}
        />
      );
    case "read":
      return (
        <CheckCheck
          className={cn("h-3 w-3 shrink-0 text-primary")}
          aria-label={t("leido")}
        />
      );
    case "failed": {
      // Failures stored before the reason existed have no text.
      const reason = errorMessage?.trim() || GENERIC_SEND_ERROR;
      // A popover, not a tooltip: it opens on tap on a phone.
      return (
        <Popover>
          <PopoverTrigger
            className="shrink-0 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-destructive"
            aria-label={t("fallido", { motivo: reason })}
          >
            <AlertCircle
              className="h-3 w-3 text-destructive"
              aria-hidden="true"
            />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-64 p-3 text-xs leading-relaxed"
          >
            {reason}
          </PopoverContent>
        </Popover>
      );
    }
    default:
      return null;
  }
}
