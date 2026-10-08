"use client";

import { useTranslations } from "next-intl";
/**
 * crm-panel.tsx — Collapsible CRM side panel for contact details.
 * Shows contact info, stage, tags, opt-in status with inline editing.
 */

import {
  Select,
  SelectItem,
  SelectValue,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { contactSubtitle } from "./channel-badge";
import type { ContactRow } from "@/features/inbox/types";
import { useState, useTransition, KeyboardEvent } from "react";
import { User, RefreshCw, Save, ChevronDown, ChevronUp, X } from "lucide-react";
import { updateContact, syncContactHL } from "../services/contact-actions";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type Stage = "new" | "engaged" | "qualified" | "customer" | "lost";

// Etapas del CRM; el nombre visible sale de inbox.crm.etapas.*
const STAGES: Stage[] = ["new", "engaged", "qualified", "customer", "lost"];

interface CrmPanelProps {
  contact: ContactRow;
  conversationId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Avatar helper
// ──────────────────────────────────────────────────────────────────────────────

function Initials({ name }: { name: string | null }) {
  const letters = name
    ? name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("")
    : "?";

  return (
    <div className="h-10 w-10 rounded-full bg-[hsl(var(--electric-lime)/0.15)] border border-[hsl(var(--electric-lime)/0.3)] flex items-center justify-center shrink-0">
      <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] font-mono">
        {letters}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// CrmPanel
// ──────────────────────────────────────────────────────────────────────────────

export function CrmPanel({
  contact,
  conversationId: _conversationId,
}: CrmPanelProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("inbox.crm");

  // Local editable state
  const [name, setName] = useState(contact.name ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [stage, setStage] = useState<Stage>(
    (contact.stage as Stage | null) ?? "new",
  );
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [optIn, setOptIn] = useState(contact.opt_in);

  // Section collapse
  const [contactOpen, setContactOpen] = useState(true);
  const [crmOpen, setCrmOpen] = useState(true);

  // ── Tag helpers ──────────────────────────────────────────────────────────────

  function addTag() {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  function handleSave() {
    startTransition(async () => {
      const result = await updateContact(contact.id, {
        name: name || undefined,
        email: email || undefined,
        stage,
        tags,
        opt_in: optIn,
      });

      if (result.ok) {
        toast.success(t("actualizado"));
      } else {
        toast.error(result.error ?? t("errorGuardar"));
      }
    });
  }

  // ── HL Sync ──────────────────────────────────────────────────────────────────

  function handleSyncHL() {
    startTransition(async () => {
      const result = await syncContactHL(contact.id, contact.workspace_id);

      if (result.ok) {
        toast.success(t("sincronizado", { id: result.data.hl_id }));
      } else {
        toast.error(result.error ?? t("errorSincronizar"));
      }
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <aside className="w-72 shrink-0 flex flex-col gap-0 border-l border-border/50 glass overflow-y-auto text-sm">
      {/* ── Section: Contact info ── */}
      <section>
        <button
          type="button"
          onClick={() => setContactOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/40 hover:bg-muted/20 transition-colors"
        >
          <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] uppercase tracking-wider">
            {t("contacto")}
          </span>
          {contactOpen ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {contactOpen && (
          <div className="px-4 py-3 space-y-3">
            {/* Avatar + phone */}
            <div className="flex items-center gap-3">
              <Initials name={name || contact.name} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {contactSubtitle(contact.phone)}
                </p>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-1">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                {t("nombre")}
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("sinNombre")}
                className="h-7 text-xs"
              />
            </div>

            {/* Email */}
            <div className="space-y-1">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                {t("email")}
              </Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                type="email"
                className="h-7 text-xs"
              />
            </div>

            {/* Opt-in switch */}
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                WhatsApp Opt-in
              </Label>
              <Switch
                checked={optIn}
                onCheckedChange={setOptIn}
                aria-label="WhatsApp Opt-in"
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Section: CRM ── */}
      <section>
        <button
          type="button"
          onClick={() => setCrmOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border/40 hover:bg-muted/20 transition-colors"
        >
          <span className="text-xs font-semibold text-[hsl(var(--electric-lime))] uppercase tracking-wider">
            CRM
          </span>
          {crmOpen ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {crmOpen && (
          <div className="px-4 py-3 space-y-3">
            {/* Stage */}
            <div className="space-y-1">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                {t("etapa")}
              </Label>
              <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {t(`etapas.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-[hsl(var(--electric-lime))] uppercase tracking-wider">
                {t("etiquetas")}
              </Label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px] pr-1 gap-1"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        aria-label={t("eliminarEtiqueta", { tag })}
                        className="hover:text-destructive transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={t("agregarEtiqueta")}
                className="h-7 text-xs"
              />
            </div>
          </div>
        )}
      </section>

      {/* ── Actions ── */}
      <div className="px-4 py-3 border-t border-border/40 flex flex-col gap-2 mt-auto">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending}
          className="w-full h-7 text-xs gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? t("guardando") : t("guardarCambios")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSyncHL}
          disabled={isPending}
          className="w-full h-7 text-xs gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Sync HighLevel
        </Button>
      </div>

      {/* Opt-out warning */}
      {!optIn && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30">
          <p className="text-[10px] text-destructive leading-snug">
            {t.rich("optOut", { fuerte: (c) => <strong>{c}</strong> })}
          </p>
        </div>
      )}
    </aside>
  );
}

// Re-export User icon for the toggle button in chat-thread
export { User };
