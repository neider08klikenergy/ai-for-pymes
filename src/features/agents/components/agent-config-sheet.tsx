"use client";

import {
  Sheet,
  SheetTitle,
  SheetHeader,
  SheetContent,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ModelPicker } from "./model-picker";
import { AgentAvatar } from "./agent-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { TestChatPanel } from "./test-chat-panel";
import type { AgentDto } from "@/features/agents/types";
import { GuidedPromptEditor } from "./guided-prompt-editor";
import { AvatarGalleryPicker } from "./avatar-gallery-picker";
import { SetterAdvancedConfig } from "./setter-advanced-config";
import { AGENT_TYPE_META } from "@/features/agents/lib/agent-meta";
import type { ResponseStyle } from "@/features/inbox/services/prompt-builder";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const STYLE_OPTIONS: { value: ResponseStyle; label: string; hint: string }[] = [
  { value: "concise", label: "conciso", hint: "breveYDirecto" },
  { value: "balanced", label: "equilibrado", hint: "porDefecto" },
  { value: "detailed", label: "detallado", hint: "masContexto" },
];

interface Props {
  workspaceId: string;
  agent: AgentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (agent: Partial<AgentDto> & { id: string }) => void;
}

export function AgentConfigSheet({
  workspaceId,
  agent,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.agentConfigSheet");
  const meta = AGENT_TYPE_META[agent.type];
  const [name, setName] = useState(agent.name);
  const [avatarKey, setAvatarKey] = useState(agent.avatarKey);
  const [model, setModel] = useState<string | null>(agent.model);
  const [autoTag, setAutoTag] = useState(Boolean(agent.config.autoTag));
  const [summarize, setSummarize] = useState(Boolean(agent.config.summarize));
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(
    agent.config.responseStyle ?? "balanced",
  );
  const [idiomaCliente, setIdiomaCliente] = useState(
    agent.config.replyInCustomerLanguage === true,
  );
  const [sleepOnManual, setSleepOnManual] = useState(
    agent.config.sleepOnManualMessage !== false,
  );
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSaveIdentity() {
    if (!name.trim()) {
      toast.error(t("elAgenteNecesitaUnNombre"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/agents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agent.id,
          name: name.trim(),
          avatarKey,
          model,
          config: {
            ...agent.config,
            autoTag,
            summarize,
            responseStyle,
            replyInCustomerLanguage: idiomaCliente,
            sleepOnManualMessage: sleepOnManual,
          },
        }),
      });
      const json = (await res.json()) as { agent?: AgentDto; error?: string };
      if (!res.ok || !json.agent) {
        toast.error(json.error ?? t("errorAlGuardar"));
        return;
      }
      toast.success(t("agenteGuardado"));
      onSaved(json.agent);
      router.refresh();
    } catch {
      toast.error(t("errorDeConexion"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <AgentAvatar
              avatarKey={avatarKey}
              name={name}
              className="h-12 w-12"
            />
            <div>
              <SheetTitle>{t("configurarAgente")}</SheetTitle>
              <SheetDescription>
                {tc(meta.label)} — {meta.tagline}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <Tabs defaultValue="identidad" className="px-4 py-2">
          <TabsList className="mb-4">
            <TabsTrigger value="identidad">{t("identidad")}</TabsTrigger>
            <TabsTrigger value="prompt">{t("prompt")}</TabsTrigger>
            {agent.type === "setter" && (
              <TabsTrigger value="avanzado">{t("avanzado")}</TabsTrigger>
            )}
            <TabsTrigger value="prueba">{t("prueba")}</TabsTrigger>
          </TabsList>

          <TabsContent value="identidad" className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="agent-name">{t("nombreDelAgente")}</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("ejCarlos")}
                maxLength={60}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("avatar")}</Label>
              <AvatarGalleryPicker value={avatarKey} onChange={setAvatarKey} />
            </div>

            <div className="space-y-2">
              <Label>{t("modeloDeIa")}</Label>
              <ModelPicker value={model} onChange={setModel} />
            </div>

            <div className="space-y-3 rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("autoEtiquetado")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("etiquetaContactosPorIntencionConIa")}
                  </p>
                </div>
                <Switch
                  checked={autoTag}
                  onCheckedChange={setAutoTag}
                  aria-label={t("autoEtiquetado")}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("resumenesAutomaticos")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("generaUnResumenDeCadaConversacion")}
                  </p>
                </div>
                <Switch
                  checked={summarize}
                  onCheckedChange={setSummarize}
                  aria-label={t("resumenesAutomaticos")}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("responderEnElIdiomaDelCliente")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("siElClienteEscribeEnIngles")}
                  </p>
                </div>
                <Switch
                  checked={idiomaCliente}
                  onCheckedChange={setIdiomaCliente}
                  aria-label={t("responderEnElIdiomaDelCliente")}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("pausarIaConMensajeManual")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("siUnHumanoRespondeEnEl")}
                  </p>
                </div>
                <Switch
                  checked={sleepOnManual}
                  onCheckedChange={setSleepOnManual}
                  aria-label={t("pausarIaConMensajeManual")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("estiloDeRespuesta")}</Label>
              <div className="grid grid-cols-3 gap-2">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setResponseStyle(opt.value)}
                    aria-pressed={responseStyle === opt.value}
                    className={cn(
                      "rounded-md border p-2 text-center transition-colors",
                      responseStyle === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-border/60 hover:bg-muted/40",
                    )}
                  >
                    <span className="block text-xs font-medium text-foreground">
                      {tc(opt.label)}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {tc(opt.hint)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleSaveIdentity}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  {t("guardando")}
                </>
              ) : (
                t("guardar")
              )}
            </Button>
          </TabsContent>

          <TabsContent value="prompt">
            <GuidedPromptEditor
              workspaceId={workspaceId}
              agent={agent}
              onPublished={(body) =>
                onSaved({ id: agent.id, promptBody: body })
              }
            />
          </TabsContent>

          {agent.type === "setter" && (
            <TabsContent value="avanzado">
              <div className="mb-4">
                <p className="text-sm text-muted-foreground">
                  {t("calificaProspectosConPreguntasEstructura")}
                </p>
              </div>
              <SetterAdvancedConfig workspaceId={workspaceId} />
            </TabsContent>
          )}

          <TabsContent value="prueba">
            <TestChatPanel workspaceId={workspaceId} agent={agent} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
