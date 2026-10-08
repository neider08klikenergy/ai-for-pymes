"use client";

import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  JevPanel,
  type JevSettings,
} from "@/features/jev-judge/components/jev-panel";
import { toast } from "sonner";
import { useState } from "react";
import { AgentCard } from "./agent-card";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AgentConfigSheet } from "./agent-config-sheet";
import type { AgentDto, AgentType } from "@/features/agents/types";

const ORDER: AgentType[] = ["setter", "soporte", "agendamiento"];

function sortAgents(list: AgentDto[]): AgentDto[] {
  return [...list].sort(
    (a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type),
  );
}

export function AgentsTab({
  workspaceId,
  initialAgents,
  jev,
  canManage,
}: {
  workspaceId: string;
  initialAgents: AgentDto[];
  jev: JevSettings;
  canManage: boolean;
}) {
  const t = useTranslations("ui.agentsTab");
  const router = useRouter();
  const [agents, setAgents] = useState<AgentDto[]>(() =>
    sortAgents(initialAgents),
  );
  const [editing, setEditing] = useState<AgentDto | null>(null);
  const [pending, setPending] = useState<AgentDto | null>(null);
  const [busy, setBusy] = useState(false);

  const currentActive = agents.find((a) => a.isActive) ?? null;

  function requestActivate(agentId: string) {
    const target = agents.find((a) => a.id === agentId);
    if (!target || target.isActive) return;
    setPending(target);
  }

  async function confirmActivate() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: pending.id, setActive: true }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? t("noSePudoActivarElAgente"));
        return;
      }
      setAgents((prev) =>
        prev.map((a) => ({ ...a, isActive: a.id === pending.id })),
      );
      toast.success(`${pending.name} está activo`);
      router.refresh();
    } catch {
      toast.error(t("errorDeConexion"));
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function handleSaved(updated: Partial<AgentDto> & { id: string }) {
    setAgents((prev) =>
      sortAgents(
        prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      ),
    );
  }

  return (
    <div className="space-y-5">
      <JevPanel
        workspaceId={workspaceId}
        initialEnabled={jev.enabled}
        initialUses={jev.uses}
        keyReady={jev.keyReady}
        judgmentsToday={jev.judgmentsToday}
        canManage={canManage}
      />
      <p className="text-sm text-muted-foreground">
        {t("configuraTus3AgentesSoloUno")}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            busy={busy}
            onConfigure={setEditing}
            onActivate={requestActivate}
          />
        ))}
      </div>

      {editing && (
        <AgentConfigSheet
          key={editing.id}
          workspaceId={workspaceId}
          agent={editing}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onSaved={handleSaved}
        />
      )}

      <Dialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("activarA")} {pending?.name}
            </DialogTitle>
            <DialogDescription>
              {currentActive && currentActive.id !== pending?.id
                ? `Esto desactivará a ${currentActive.name}. Solo un agente puede estar activo a la vez.`
                : t("activarEsteAgente")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("cancelar")}
            </Button>
            <Button onClick={confirmActivate} disabled={busy} aria-busy={busy}>
              {t("activar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
