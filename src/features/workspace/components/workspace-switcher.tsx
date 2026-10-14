"use client";

import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { switchWorkspace } from "@/features/workspace/services/actions";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";

interface WorkspaceSwitcherProps {
  workspaces: { workspace_id: string; name: string }[];
  activeId: string;
  /** Super admin: enlace a la lista completa en la Agencia. */
  verTodos?: boolean;
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  verTodos = false,
}: WorkspaceSwitcherProps) {
  const t = useTranslations("ui.workspaceSwitcher");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const active = workspaces.find((w) => w.workspace_id === activeId);

  function handleSelect(workspaceId: string) {
    if (workspaceId === activeId) return;
    startTransition(async () => {
      await switchWorkspace(workspaceId);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2.5 transition-colors",
            "text-sm text-foreground hover:bg-muted/40",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "max-w-[160px] sm:max-w-[220px]",
          )}
          aria-label={t("cambiarDeWorkspace")}
        >
          <span className="truncate" title={active?.name}>
            {active?.name ?? t("workspace")}
          </span>
          {isPending ? (
            <Loader2
              className="h-3 w-3 shrink-0 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <ChevronsUpDown
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 max-h-80 overflow-y-auto"
      >
        <DropdownMenuLabel>{t("cambiarDeWorkspace")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.workspace_id}
            onSelect={() => handleSelect(w.workspace_id)}
            className="gap-2"
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                w.workspace_id === activeId ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <span className="truncate">{w.name}</span>
          </DropdownMenuItem>
        ))}
        {verTodos && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="gap-2">
              <Link href="/workspaces">
                <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("verTodos")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
