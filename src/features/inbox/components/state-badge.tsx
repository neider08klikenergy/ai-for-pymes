"use client";

import { useTranslations } from "next-intl";
// F3-T5: Visual badge for conversation state.

import {
  Bot,
  User,
  Clock,
  XCircle,
  AlertCircle,
  PauseCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationState } from "@/features/inbox/types";

interface StateBadgeProps {
  state: ConversationState;
}

const STATE_CONFIG: Record<
  ConversationState,
  {
    label: string;
    className: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  ai_active: {
    label: "ai_active",
    className: "text-[hsl(var(--electric-lime))]",
    Icon: Bot,
  },
  human_active: {
    label: "human_active",
    className: "text-blue-400",
    Icon: User,
  },
  handoff_pending: {
    label: "handoff_pending",
    className: "text-amber-400",
    Icon: AlertCircle,
  },
  waiting_reply: {
    label: "waiting",
    className: "text-muted-foreground",
    Icon: Clock,
  },
  paused: {
    label: "paused",
    className: "text-muted-foreground",
    Icon: PauseCircle,
  },
  closed: {
    label: "closed",
    className: "text-muted-foreground/50",
    Icon: XCircle,
  },
};

export function StateBadge({ state }: StateBadgeProps) {
  const config = STATE_CONFIG[state];
  const t = useTranslations("inbox.estados");

  if (!config) return null;

  const { className, Icon } = config;
  // config.label es la clave del estado (inbox.estados.*)
  const label = t(config.label as "ai_active");

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs", className)}
      title={label}
      aria-label={label}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
