"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { login } from "@/features/auth/services/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
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
          Iniciando sesión...
        </>
      ) : (
        "Iniciar sesión"
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

  return (
    <div className={cn("glass rounded-xl p-8 w-full max-w-md space-y-6")}>
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Bienvenido de vuelta
        </h1>
        <p className="text-sm text-muted-foreground">
          Ingresa a tu cuenta para continuar
        </p>
      </div>

      {message && (
        <p
          className="text-sm text-primary bg-primary/10 rounded-md px-3 py-2"
          role="status"
        >
          {message}
        </p>
      )}

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="tu@email.com"
            autoComplete="email"
            aria-required="true"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
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
          ¿No tienes cuenta?{" "}
          <Link
            href="/signup"
            className="text-primary underline-offset-4 hover:underline transition-colors duration-150"
          >
            Crear cuenta
          </Link>
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          ¿Aún no tienes cuenta?{" "}
          <Link
            href="/demo"
            className="text-primary underline-offset-4 hover:underline transition-colors duration-150"
          >
            Agenda una demo
          </Link>
        </p>
      )}
    </div>
  );
}
