"use client";

// Mi cuenta → Contraseña: cada persona cambia la suya con la contraseña
// actual. Al cambiarla se cierran sus demás sesiones.

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { cambiarContrasena } from "../services/actions";
import { useActionState, useEffect, useRef, useState } from "react";

function CampoContrasena({
  id,
  name,
  label,
  autoComplete,
  visible,
  ayuda,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  visible: boolean;
  ayuda?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={name === "actual" ? undefined : 8}
        required
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
      />
      {ayuda && (
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      )}
    </div>
  );
}

export function CambiarContrasena() {
  const [state, formAction, pending] = useActionState(cambiarContrasena, null);
  const [visible, setVisible] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      form.current?.reset();
      toast.success("Contraseña actualizada. Cerramos tus otras sesiones.");
    }
  }, [state]);

  return (
    <section
      aria-labelledby="mi-contrasena-titulo"
      className="rounded-xl border border-border/60 bg-card p-5"
    >
      <div className="mb-4">
        <h2 id="mi-contrasena-titulo" className="text-base font-semibold">
          Contraseña
        </h2>
        <p className="text-sm text-muted-foreground">
          Al cambiarla se cierran tus sesiones abiertas en otros equipos.
        </p>
      </div>

      <form ref={form} action={formAction} className="max-w-md space-y-4">
        <CampoContrasena
          id="contrasena-actual"
          name="actual"
          label="Contraseña actual"
          autoComplete="current-password"
          visible={visible}
        />
        <CampoContrasena
          id="contrasena-nueva"
          name="nueva"
          label="Nueva contraseña"
          autoComplete="new-password"
          visible={visible}
          ayuda="Mínimo 8 caracteres."
        />
        <CampoContrasena
          id="contrasena-confirmar"
          name="confirmar"
          label="Repite la nueva contraseña"
          autoComplete="new-password"
          visible={visible}
        />

        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground mr-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
          {visible ? "Ocultar contraseñas" : "Mostrar contraseñas"}
        </button>

        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          Cambiar contraseña
        </Button>
      </form>
    </section>
  );
}
