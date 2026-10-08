"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Lightbulb } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { AgentDto } from "@/features/agents/types";
import { AGENT_TYPE_META } from "@/features/agents/lib/agent-meta";

interface Props {
  workspaceId: string;
  agent: AgentDto;
  onPublished: (body: string) => void;
}

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function GuidedPromptEditor({ workspaceId, agent, onPublished }: Props) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.guidedPromptEditor");
  const meta = AGENT_TYPE_META[agent.type];
  const router = useRouter();
  const [body, setBody] = useState(agent.promptBody);
  const [rules, setRules] = useState(
    (agent.promptGuardrails?.rules ?? []).join("\n"),
  );
  const [restrictions, setRestrictions] = useState(
    (agent.promptGuardrails?.restrictions ?? []).join("\n"),
  );
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function createDraft(): Promise<{
    promptId: string;
    versionId: string;
  } | null> {
    const res = await fetch(`/api/workspace/${workspaceId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promptName: `Agente ${agent.type}`,
        scope: "mode",
        scopeRef: agent.type,
        body,
        guardrails: {
          rules: linesToArray(rules),
          restrictions: linesToArray(restrictions),
        },
      }),
    });
    const json = (await res.json()) as {
      data?: { promptId: string; versionId: string };
      error?: unknown;
    };
    if (!res.ok || !json.data) {
      toast.error(
        typeof json.error === "string" ? json.error : t("errorAlGuardar"),
      );
      return null;
    }
    return json.data;
  }

  async function handleSaveDraft() {
    if (!body.trim()) {
      toast.error(t("elPromptNoPuedeEstarVacio"));
      return;
    }
    setSavingDraft(true);
    try {
      const draft = await createDraft();
      if (draft) toast.success(t("borradorGuardado"));
    } catch {
      toast.error(t("errorDeConexion"));
    } finally {
      setSavingDraft(false);
    }
  }

  async function handlePublish() {
    if (!body.trim()) {
      toast.error(t("elPromptNoPuedeEstarVacio"));
      return;
    }
    setPublishing(true);
    try {
      const draft = await createDraft();
      if (!draft) return;
      const res = await fetch(`/api/workspace/${workspaceId}/prompts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId: draft.promptId,
          versionId: draft.versionId,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? t("errorAlPublicar"));
        return;
      }
      // Point the agent at the just-published prompt so it's the one read back
      // (listAgents reads promptBody via agent.prompt_id). Without this the
      // editor reverts to the seeded prompt when re-mounted.
      await fetch(`/api/workspace/${workspaceId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.id, promptId: draft.promptId }),
      });
      toast.success(t("promptPublicado"));
      onPublished(body);
      router.refresh();
    } catch {
      toast.error(t("errorDeConexion"));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {t("guiaPara")} {tc(meta.label)}
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {meta.promptGuidance.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-prompt">{t("instruccionesDelAgente")}</Label>
        <Textarea
          id="agent-prompt"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder={t("describeComoDebeComportarseElAgente")}
        />
        <p className="text-[11px] text-muted-foreground">
          {t("variablesDisponibles")}{" "}
          <span className="font-mono">{"{{business_name}}"}</span>,{" "}
          <span className="font-mono">{"{{agent_name}}"}</span>,{" "}
          <span className="font-mono">{"{{contact.name}}"}</span>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-rules">{t("reglasQueSiDebeHacer")}</Label>
        <Textarea
          id="agent-rules"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={3}
          placeholder={t("unaReglaPorLineaEjConfirma")}
        />
        <p className="text-[11px] text-muted-foreground">
          {t("unaPorLineaSeInyectanComo")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-restrictions">
          {t("restriccionesQueNuncaDebeHacer")}
        </Label>
        <Textarea
          id="agent-restrictions"
          value={restrictions}
          onChange={(e) => setRestrictions(e.target.value)}
          rows={3}
          placeholder={t("unaRestriccionPorLineaEjNo")}
        />
        <p className="text-[11px] text-muted-foreground">
          {t("unaPorLineaElAgenteTiene")}
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          disabled={savingDraft || publishing}
          aria-busy={savingDraft}
        >
          {savingDraft ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          {t("guardarBorrador")}
        </Button>
        <Button
          onClick={handlePublish}
          disabled={publishing || savingDraft}
          aria-busy={publishing}
        >
          {publishing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          {t("publicar")}
        </Button>
      </div>
    </div>
  );
}
