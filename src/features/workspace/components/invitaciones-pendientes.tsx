"use client";

// Aviso en el panel con las invitaciones pendientes de quien inició sesión:
// entra a un workspace solo si acepta.

import { toast } from "sonner";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { responderInvitacion } from "../services/invitaciones-actions";

export interface InvitacionPendiente {
  id: string;
  workspace_nombre: string;
  role: "admin" | "manager" | "agent" | "viewer";
}

export function InvitacionesPendientes({
  invitaciones,
}: {
  invitaciones: InvitacionPendiente[];
}) {
  const t = useTranslations("common.invitaciones");
  const router = useRouter();
  const [respondiendo, setRespondiendo] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (invitaciones.length === 0) return null;

  function responder(id: string, aceptar: boolean) {
    setRespondiendo(id);
    startTransition(async () => {
      const r = await responderInvitacion({ invitacionId: id, aceptar });
      setRespondiendo(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.mensaje);
      router.refresh();
    });
  }

  return (
    <div className="border-b border-border/50 bg-primary/5 px-3 py-2 sm:px-6">
      <ul className="mx-auto grid max-w-5xl gap-2">
        {invitaciones.map((inv) => (
          <li
            key={inv.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="flex items-center gap-2 text-foreground">
              <MailPlus className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t.rich("texto", {
                workspace: inv.workspace_nombre,
                rol: t(`roles.${inv.role}`),
                b: (chunks) => <strong className="font-semibold">{chunks}</strong>,
              })}
            </span>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={respondiendo === inv.id}
                onClick={() => responder(inv.id, false)}
              >
                {t("rechazar")}
              </Button>
              <Button
                size="sm"
                disabled={respondiendo === inv.id}
                onClick={() => responder(inv.id, true)}
              >
                {t("aceptar")}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
