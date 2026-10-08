"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

interface WindowBannerProps {
  windowExpiresAt: string | null;
}

export function WindowBanner({ windowExpiresAt }: WindowBannerProps) {
  const t = useTranslations("inbox.chat");
  // No window tracked → treat as open
  if (windowExpiresAt === null) return null;

  // Window still open
  if (new Date(windowExpiresAt) > new Date()) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2",
        "bg-amber-500/10 border border-amber-500/30 text-amber-400",
        "rounded-lg py-2 px-3 text-sm font-body",
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{t("ventanaExpirada")}</span>
    </div>
  );
}
