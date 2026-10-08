"use client";

import { cn } from "@/lib/utils";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updatePassword } from "@/features/auth/services/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth.reset");
  return (
    <Button
      type="submit"
      variant="default"
      className="w-full"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("enviando")}
        </>
      ) : (
        t("boton")
      )}
    </Button>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, null);
  const t = useTranslations("auth.reset");

  return (
    <div className={cn("glass rounded-xl p-8 w-full max-w-md space-y-6")}>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("titulo")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitulo")}</p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t("campo")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            aria-required="true"
            required
          />
        </div>

        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
