"use client";

import type {
  ConversationState,
  ConversationWithContact,
} from "@/features/inbox/types";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConversationItem } from "./conversation-item";
import { usePathname, useRouter } from "next/navigation";
import { useRealtimeConversations } from "@/features/inbox/hooks/use-realtime-conversations";

type FilterTab = "all" | "ai_active" | "human_active" | "handoff_pending";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "todos" },
  { id: "ai_active", label: "iaActiva" },
  { id: "human_active", label: "humano" },
  { id: "handoff_pending", label: "handoff" },
];

interface InboxLayoutProps {
  conversations: ConversationWithContact[];
  workspaceId: string | null;
  children: React.ReactNode;
}

export function InboxLayout({
  conversations,
  workspaceId,
  children,
}: InboxLayoutProps) {
  const t = useTranslations("inbox.lista");
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  // Live-update the list when chats arrive/change (new conversation, new
  // message, state/handoff change) — re-runs the server component.
  useRealtimeConversations(workspaceId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const matchesSearch =
        q === "" ||
        (c.contact.name ?? "").toLowerCase().includes(q) ||
        c.contact.phone.toLowerCase().includes(q);

      const matchesTab =
        activeTab === "all" ||
        (c.state as ConversationState) === (activeTab as ConversationState);

      return matchesSearch && matchesTab;
    });
  }, [conversations, search, activeTab]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left panel — conversation list */}
      <aside
        className={cn(
          "w-80 shrink-0 border-r border-border/50 flex flex-col overflow-hidden",
        )}
        aria-label={t("conversaciones")}
      >
        {/* Header */}
        <div className="shrink-0 px-4 pt-3 pb-2 border-b border-border/50 space-y-2">
          <div className="flex items-baseline justify-between">
            <h1 className="font-display text-sm font-semibold text-foreground">
              Inbox
            </h1>
            <p className="text-xs text-muted-foreground">
              {filtered.length} de {conversations.length}
            </p>
          </div>

          {/* Search input */}
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("buscar")}
              className="pl-8 h-8 text-xs bg-muted/30 border-border/40 placeholder:text-muted-foreground/50"
              aria-label={t("buscarConversaciones")}
            />
          </div>

          {/* Status filter tabs */}
          <div
            role="tablist"
            aria-label={t("filtrarEstado")}
            className="flex gap-1 flex-wrap"
          >
            {TABS.map((tab) => (
              <Button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "h-6 px-2 text-[11px] rounded-md transition-colors",
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
              >
                {t(`filtros.${tab.label}` as "filtros.todos")}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <p className="text-sm text-muted-foreground">
                {search || activeTab !== "all"
                  ? t("sinResultados")
                  : t("sinConversaciones")}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {search || activeTab !== "all"
                  ? t("otroFiltro")
                  : t("apareceran")}
              </p>
            </div>
          ) : (
            <ul role="list">
              {filtered.map((conversation) => {
                const isActive = pathname.includes(conversation.id);
                return (
                  <li key={conversation.id}>
                    <ConversationItem
                      conversation={conversation}
                      isActive={isActive}
                      onClick={() => router.push(`/inbox/${conversation.id}`)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Right panel — thread / detail */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
