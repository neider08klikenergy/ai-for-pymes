"use client";

// Mi cuenta → Configuración de Felrick (solo super admin): contacto de
// soporte que ven los workspaces en el botón Soporte del panel.

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Building, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { guardarPerfilPlataforma } from "../services/perfil-actions";
import { MAX_WHATSAPP_SOPORTE, type ContactoSoporte } from "../lib/perfil";

export function PerfilForm({ inicial }: { inicial: ContactoSoporte }) {
  const [email, setEmail] = useState(inicial.email ?? "");
  const [whatsapp, setWhatsapp] = useState(inicial.whatsapp.join("\n"));
  const [guardando, startGuardar] = useTransition();

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    startGuardar(async () => {
      const r = await guardarPerfilPlataforma({ email, whatsapp });
      if (r.ok) toast.success("Configuración de Felrick guardada");
      else toast.error(r.error);
    });
  }

  return (
    <section
      aria-labelledby="config-felrick-titulo"
      className="rounded-xl border border-border/60 bg-card p-5"
    >
      <div className="mb-4">
        <h2
          id="config-felrick-titulo"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <Building className="h-4 w-4 text-primary" aria-hidden="true" />
          Configuración de Felrick
        </h2>
        <p className="text-sm text-muted-foreground">
          Solo para el equipo de Felrick. Es el contacto de soporte que ven
          todos los workspaces en el botón Soporte.
        </p>
      </div>

      <form onSubmit={guardar} className="flex max-w-md flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="perfil-email">Correo de soporte</Label>
          <Input
            id="perfil-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="soporte@tudominio.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="perfil-whatsapp">WhatsApp de soporte</Label>
          <Textarea
            id="perfil-whatsapp"
            rows={3}
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="+573001234567"
          />
          <p className="text-xs text-muted-foreground">
            Uno por línea, con + y el indicativo del país. Máximo{" "}
            {MAX_WHATSAPP_SOPORTE}. Deja vacío lo que no quieras mostrar.
          </p>
        </div>
        <div>
          <Button
            type="submit"
            size="sm"
            disabled={guardando}
            aria-busy={guardando}
          >
            {guardando && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Guardar
          </Button>
        </div>
      </form>
    </section>
  );
}
