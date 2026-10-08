"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAiToggle } from "@/features/inbox/hooks/use-ai-toggle";

interface AiToggleButtonProps {
  conversationId: string;
  initialEnabled: boolean;
}

export function AiToggleButton({
  conversationId,
  initialEnabled,
}: AiToggleButtonProps) {
  const t = useTranslations("inbox.chat");
  const { aiEnabled, toggle, isPending } = useAiToggle(
    conversationId,
    initialEnabled,
  );

  const switchId = `ai-toggle-${conversationId}`;

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={switchId}
        checked={aiEnabled}
        onCheckedChange={toggle}
        disabled={isPending}
        aria-busy={isPending}
      />
      <Label
        htmlFor={switchId}
        className={cn(
          "text-xs font-medium cursor-pointer select-none transition-colors duration-150",
          aiEnabled ? "text-primary" : "text-muted-foreground",
        )}
      >
        {aiEnabled ? t("iaActiva") : t("humanoActivo")}
      </Label>
    </div>
  );
}
