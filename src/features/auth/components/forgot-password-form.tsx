"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/features/auth/services/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth.forgot");
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

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, null);
  const t = useTranslations("auth");

  return (
    <div className={cn("glass rounded-xl p-8 w-full max-w-md space-y-6")}>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("forgot.titulo")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("forgot.subtitulo")}</p>
      </div>

      {state?.message ? (
        <p
          className="text-sm text-primary bg-primary/10 rounded-md px-3 py-2"
          role="status"
        >
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t("placeholderEmail")}
              autoComplete="email"
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
      )}

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline transition-colors duration-150"
        >
          {t("forgot.volver")}
        </Link>
      </p>
    </div>
  );
}
