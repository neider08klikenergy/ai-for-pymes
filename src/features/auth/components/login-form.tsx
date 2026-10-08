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
import { login } from "@/features/auth/services/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations("auth.login");
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

export function LoginForm({
  message,
  signupOpen,
}: {
  message?: string;
  signupOpen: boolean;
}) {
  const [state, formAction] = useActionState(login, null);
  const t = useTranslations("auth");
  // Los avisos llegan como código (?message=revisaEmail); un texto viejo se muestra tal cual
  const aviso =
    message && t.has(`avisos.${message}`)
      ? t(`avisos.${message}` as "avisos.revisaEmail")
      : message;

  return (
    <div className={cn("glass rounded-xl p-8 w-full max-w-md space-y-6")}>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {t("login.titulo")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("login.subtitulo")}</p>
      </div>

      {aviso && (
        <p
          className="text-sm text-primary bg-primary/10 rounded-md px-3 py-2"
          role="status"
        >
          {aviso}
        </p>
      )}

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

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">{t("contrasena")}</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("login.olvide")}
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
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

      {/* El registro público solo está abierto para la primera cuenta (super
          admin). Después las cuentas las crea el equipo de Felrick. */}
      {signupOpen ? (
        <p className="text-center text-sm text-muted-foreground">
          {t("login.sinCuenta")}{" "}
          <Link
            href="/signup"
            className="text-primary underline-offset-4 hover:underline transition-colors duration-150"
          >
            {t("login.crearCuenta")}
          </Link>
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {t("login.aunSinCuenta")}{" "}
          <Link
            href="/demo"
            className="text-primary underline-offset-4 hover:underline transition-colors duration-150"
          >
            {t("login.agendaDemo")}
          </Link>
        </p>
      )}
    </div>
  );
}
