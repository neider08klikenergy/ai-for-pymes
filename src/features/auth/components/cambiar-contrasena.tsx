"use client";

// "Mi contraseña" en Settings → Equipo: cada persona cambia la suya, con la
// contraseña actual. Al cambiarla se cierran sus demás sesiones.

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { KeyRound, Loader2 } from "lucide-react";
import { cambiarContrasena } from "../services/actions";
import { useActionState, useEffect, useRef } from "react";

export function CambiarContrasena() {
  const [state, formAction, pending] = useActionState(cambiarContrasena, null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      form.current?.reset();
      toast.success("Contraseña actualizada. Cerramos tus otras sesiones.");
    }
  }, [state]);

  return (
    <section
      className="grid gap-4 rounded-lg border border-border/60 p-4"
      aria-labelledby="mi-contrasena-titulo"
    >
      <div className="flex gap-3">
        <KeyRound
          className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div>
          <h3 id="mi-contrasena-titulo" className="text-sm font-semibold">
            Mi contraseña
          </h3>
          <p className="text-xs text-muted-foreground">
            Mínimo 8 caracteres. Al cambiarla se cierran tus sesiones en otros
            equipos.
          </p>
        </div>
      </div>

      <form
        ref={form}
        action={formAction}
        className="grid gap-3 sm:grid-cols-3"
      >
        <div className="space-y-1.5">
          <Label htmlFor="contrasena-actual">Contraseña actual</Label>
          <Input
            id="contrasena-actual"
            name="actual"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contrasena-nueva">Nueva contraseña</Label>
          <Input
            id="contrasena-nueva"
            name="nueva"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contrasena-confirmar">Repite la nueva</Label>
          <Input
            id="contrasena-confirmar"
            name="confirmar"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        {state?.error && (
          <p className="text-sm text-destructive sm:col-span-3" role="alert">
            {state.error}
          </p>
        )}

        <div className="sm:col-span-3">
          <Button
            type="submit"
            size="sm"
            disabled={pending}
            aria-busy={pending}
          >
            {pending && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            Cambiar contraseña
          </Button>
        </div>
      </form>
    </section>
  );
}
