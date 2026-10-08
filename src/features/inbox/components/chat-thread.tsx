"use client";

import {
  X,
  Bot,
  Send,
  User,
  ImagePlus,
  UserCheck,
  BarChart2,
  StickyNote,
  AlertCircle,
} from "lucide-react";
import {
  canHandoff,
  canSendMessages,
  canTakeConversation,
  canViewObservability,
} from "@/features/inbox/hooks/use-role";
import type {
  MessageRow,
  ConversationWithContact,
} from "@/features/inbox/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CrmPanel } from "./crm-panel";
import { RoleGate } from "./role-gate";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChatMessage } from "./chat-message";
import { WindowBanner } from "./window-banner";
import { Button } from "@/components/ui/button";
import { TemplatePicker } from "./template-picker";
import { AiToggleButton } from "./ai-toggle-button";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ObservabilityPanel } from "./observability-panel";
import { prepareImage } from "@/features/inbox/lib/prepare-image";
import type { WorkspaceRole } from "@/features/inbox/hooks/use-role";
import { OUTBOUND_CAPTION_MAX } from "@/features/inbox/lib/outbound-image";
import { ChannelBadge, contactSubtitle, isSocialKey } from "./channel-badge";
import { useRealtimeMessages } from "@/features/inbox/hooks/use-realtime-messages";

interface ChatThreadProps {
  conversation: ConversationWithContact;
  initialMessages: MessageRow[];
  currentUserId: string;
  role?: WorkspaceRole;
}

export function ChatThread({
  conversation,
  initialMessages,
  currentUserId,
  role = "agent",
}: ChatThreadProps) {
  const messages = useRealtimeMessages(conversation.id, initialMessages);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showCrm, setShowCrm] = useState(false);
  const [showObservability, setShowObservability] = useState(false);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Imagen adjunta lista para enviar; el texto del composer va como pie de foto.
  const [image, setImage] = useState<{ file: File; preview: string } | null>(
    null,
  );
  const [preparing, setPreparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const router = useRouter();
  const t = useTranslations("inbox.chat");

  // Mirrors the conversations UPDATE policy the server enforces for toggling
  // the AI and handing a thread back to it: admins, managers, or the member
  // the thread is assigned to.
  const canUpdateConversation =
    role === "admin" ||
    role === "manager" ||
    conversation.assigned_to === currentUserId;

  const isWindowExpired =
    conversation.window_expires_at != null &&
    new Date(conversation.window_expires_at) < new Date();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // La vista previa es un object URL: se libera al cambiarla o al salir.
  useEffect(() => {
    if (!image) return;
    return () => URL.revokeObjectURL(image.preview);
  }, [image]);

  const attachImage = async (file: File | undefined | null) => {
    if (!file) return;
    setPreparing(true);
    try {
      const ready = await prepareImage(file);
      if ("error" in ready) {
        toast.error(ready.error);
        return;
      }
      setImage({ file: ready, preview: URL.createObjectURL(ready) });
    } finally {
      setPreparing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSendImage = async () => {
    if (!image || sending) return;
    const caption = draft.trim();
    if (caption.length > OUTBOUND_CAPTION_MAX) {
      toast.error(t("pieMuyLargo", { max: OUTBOUND_CAPTION_MAX }));
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append("file", image.file);
      if (caption) form.append("caption", caption);
      const res = await fetch(`/api/conversations/${conversation.id}/media`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error ?? t("errorImagen"));
        return;
      }
      setImage(null);
      setDraft("");
    } catch {
      toast.error(t("errorImagen"));
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (image) return handleSendImage();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmed }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error ?? t("errorEnviar"));
        return;
      }
      setDraft("");
    } catch {
      toast.error(t("errorEnviar"));
    } finally {
      setSending(false);
    }
  };

  const handleHandoffRequest = async () => {
    setHandoffLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? t("errorHandoff"));
        return;
      }
      toast.success(t("handoffSolicitado"));
      router.refresh();
    } catch {
      toast.error(t("errorConexion"));
    } finally {
      setHandoffLoading(false);
    }
  };

  const handleReturnToAi = async () => {
    setHandoffLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? t("errorDevolver"));
        return;
      }
      toast.success(t("devuelta"));
      router.refresh();
    } catch {
      toast.error(t("errorConexion"));
    } finally {
      setHandoffLoading(false);
    }
  };

  const handleSaveNote = async () => {
    const trimmed = note.trim();
    if (!trimmed || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error((data as { error?: string }).error ?? t("errorNota"));
        return;
      }
      setNote("");
      setNoteMode(false);
      toast.success(t("notaGuardada"));
    } catch {
      toast.error(t("errorConexion"));
    } finally {
      setSavingNote(false);
    }
  };

  const handleTakeConversation = async () => {
    setHandoffLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/take`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? t("errorTomar"));
        return;
      }
      toast.success(t("tomada"));
      router.refresh();
    } catch {
      toast.error(t("errorConexion"));
    } finally {
      setHandoffLoading(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col md:flex-row">
      {/* Left: thread */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Sticky header */}
        <header
          className={cn(
            "glass-strong shrink-0 flex items-center justify-between",
            "px-4 py-3 border-b border-border/50",
          )}
        >
          <div className="space-y-0.5 min-w-0">
            <h2 className="font-display text-sm font-semibold text-foreground truncate">
              {conversation.contact.name ??
                contactSubtitle(
                  conversation.contact.phone,
                  conversation.channel,
                )}
            </h2>
            <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              <ChannelBadge channel={conversation.channel} withLabel />
              {!isSocialKey(conversation.contact.phone) &&
                conversation.contact.phone}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Handoff button — gated by role */}
            {conversation.state === "ai_active" && (
              <RoleGate role={role} check={canHandoff}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleHandoffRequest}
                  disabled={handoffLoading}
                  aria-label={t("solicitarHandoff")}
                  className="h-8 gap-1.5 text-xs text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                >
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("handoff")}
                </Button>
              </RoleGate>
            )}

            {/* Take conversation button — gated by role */}
            {conversation.state === "handoff_pending" && (
              <RoleGate role={role} check={canTakeConversation}>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={handleTakeConversation}
                  disabled={handoffLoading}
                  aria-label={t("tomarConversacion")}
                  className="h-8 gap-1.5 text-xs"
                >
                  <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("tomar")}
                </Button>
              </RoleGate>
            )}

            {/* Return to AI — human_active only, for whoever may update it */}
            {conversation.state === "human_active" && canUpdateConversation && (
              <RoleGate role={role} check={canTakeConversation}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleReturnToAi}
                  disabled={handoffLoading}
                  aria-label={t("devolverConversacion")}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("devolver")}
                </Button>
              </RoleGate>
            )}

            {/* Observability toggle — gated by role */}
            <RoleGate role={role} check={canViewObservability}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setShowObservability((v) => !v)}
                aria-label={t("verObservabilidad")}
                aria-pressed={showObservability}
                className={cn(
                  "h-8 w-8",
                  showObservability &&
                    "bg-[hsl(var(--electric-lime)/0.1)] text-[hsl(var(--electric-lime))]",
                )}
              >
                <BarChart2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </RoleGate>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setShowCrm((v) => !v)}
              aria-label={t("verContacto")}
              aria-pressed={showCrm}
              className={cn(
                "h-8 w-8",
                showCrm &&
                  "bg-[hsl(var(--electric-lime)/0.1)] text-[hsl(var(--electric-lime))]",
              )}
            >
              <User className="h-4 w-4" aria-hidden="true" />
            </Button>
            {canUpdateConversation && (
              <AiToggleButton
                conversationId={conversation.id}
                initialEnabled={conversation.ai_enabled}
              />
            )}
          </div>
        </header>

        <WindowBanner
          windowExpiresAt={conversation.window_expires_at ?? null}
        />

        {/* Message list */}
        <ScrollArea className="flex-1 px-4">
          <div className="py-4 space-y-2">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("sinMensajes")}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {t("sinMensajesAyuda")}
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))
            )}
            <div ref={bottomRef} aria-hidden="true" />
          </div>
        </ScrollArea>

        {/* Footer composer */}
        <footer
          className={cn(
            "shrink-0 border-t border-border/50 p-3 transition-colors duration-200",
            noteMode && "bg-warning/5 border-warning/20",
          )}
        >
          {/* Permissions first: with the 24h window closed, a viewer must still
              see "read only", not a template picker offering to send. */}
          {!canSendMessages(role) ? (
            <p className="py-2 text-center text-xs text-muted-foreground/60 select-none">
              {t("soloLectura")}
            </p>
          ) : isWindowExpired ? (
            <TemplatePicker conversationId={conversation.id} />
          ) : noteMode ? (
            /* ── Note mode composer ───────────────────────────── */
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-warning">
                  <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-[11px] font-medium">
                    {t("notaInternaAviso")}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNoteMode(false);
                    setNote("");
                  }}
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  aria-label={t("cancelarNota")}
                >
                  {t("cancelar")}
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("notaPlaceholder")}
                  className="min-h-[40px] max-h-32 resize-none flex-1 text-sm border-warning/30 focus-visible:ring-warning/40"
                  rows={2}
                  aria-label={t("notaInterna")}
                  disabled={savingNote}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSaveNote();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSaveNote()}
                  disabled={savingNote || note.trim().length === 0}
                  aria-label={t("guardarNotaInterna")}
                  aria-busy={savingNote}
                  className="shrink-0 h-10 border-warning/30 text-warning hover:bg-warning/10"
                >
                  {savingNote ? t("guardando") : t("guardarNota")}
                </Button>
              </div>
            </div>
          ) : (
            /* ── Normal message composer ──────────────────────── */
            <div className="space-y-2">
              {image && (
                <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.preview}
                    alt={t("imagenAEnviar")}
                    className="h-14 w-14 shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {image.file.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {(image.file.size / 1024 / 1024).toFixed(1)} MB · el texto
                      que escribas va como pie de foto
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setImage(null)}
                    disabled={sending}
                    aria-label={t("quitarImagen")}
                    className="h-8 w-8 shrink-0"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setNoteMode(true)}
                  aria-label={t("agregarNota")}
                  aria-pressed={noteMode}
                  className="shrink-0 h-10 w-10 text-muted-foreground hover:text-warning hover:bg-warning/10"
                >
                  <StickyNote className="h-4 w-4" aria-hidden="true" />
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void attachImage(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || preparing}
                  aria-label={t("adjuntarImagen")}
                  aria-busy={preparing}
                  className="shrink-0 h-10 w-10 text-muted-foreground"
                >
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPaste={(e) => {
                    const pasted = Array.from(e.clipboardData.files).find((f) =>
                      f.type.startsWith("image/"),
                    );
                    if (pasted) {
                      e.preventDefault();
                      void attachImage(pasted);
                    }
                  }}
                  placeholder={
                    image ? t("piePlaceholder") : t("mensajePlaceholder")
                  }
                  className="min-h-[40px] max-h-32 resize-none flex-1 text-sm"
                  rows={2}
                  aria-label={t("mensaje")}
                  disabled={sending}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="default"
                  onClick={() => void handleSend()}
                  disabled={
                    sending ||
                    preparing ||
                    (!image && draft.trim().length === 0)
                  }
                  aria-label={image ? t("enviarImagen") : t("enviarMensaje")}
                  aria-busy={sending}
                  className="shrink-0 h-10 w-10"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </footer>
      </div>

      {/* Right: CRM panel */}
      {showCrm && (
        <CrmPanel
          contact={conversation.contact}
          conversationId={conversation.id}
        />
      )}

      {/* Right: Observability panel */}
      {showObservability && (
        <div className="w-full md:w-80 shrink-0 border-t md:border-t-0 md:border-l border-border/50 overflow-y-auto p-3">
          <ObservabilityPanel conversationId={conversation.id} />
        </div>
      )}
    </div>
  );
}
