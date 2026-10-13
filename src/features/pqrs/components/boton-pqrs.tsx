"use client";

// Botón "Soporte" de la barra superior: abre el formulario de PQRS. La página
// actual se envía sola; el navegador y la versión los toma el servidor.

import {
  enlaceWhatsapp,
  type ContactoSoporte,
} from "@/features/plataforma/lib/perfil";
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TIPOS_PQRS, TIPO_PQRS_LABEL } from "../lib/pqrs";
import { prepareImage } from "@/features/inbox/lib/prepare-image";
import { LifeBuoy, Loader2, Mail, MessageCircle } from "lucide-react";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function BotonPqrs({
  workspaceId,
  contacto,
}: {
  workspaceId: string;
  /** Contacto de soporte de Agencia → Perfil. */
  contacto: ContactoSoporte;
}) {
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const datos = new FormData(e.currentTarget);
    datos.set("workspaceId", workspaceId);
    datos.set("pagina", window.location.pathname);

    const archivo = datos.get("file");
    if (archivo instanceof File && archivo.size > 0) {
      const lista = await prepareImage(archivo);
      if ("error" in lista) {
        setError(lista.error);
        return;
      }
      datos.set("file", lista);
    } else {
      datos.delete("file");
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/pqrs", { method: "POST", body: datos });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          json.error ?? "No se pudo enviar el reporte. Intenta de nuevo.",
        );
        return;
      }
      form.current?.reset();
      setAbierto(false);
      toast.success("¡Gracias! Recibimos tu reporte y lo vamos a revisar.");
    } catch {
      setError("Sin conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setAbierto(true)}
        aria-label="Soporte"
        title="Soporte"
      >
        <LifeBuoy className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Dialog
        open={abierto}
        onOpenChange={(o) => {
          if (!enviando) setAbierto(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reportar o sugerir algo</DialogTitle>
            <DialogDescription>
              Cuéntanos qué pasó o qué necesitas. Lo revisa el equipo de
              soporte.
            </DialogDescription>
          </DialogHeader>

          {(contacto.email || contacto.whatsapp.length > 0) && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <p className="mb-1.5 font-medium">
                ¿Prefieres escribirnos directamente?
              </p>
              <ul className="space-y-1">
                {contacto.email && (
                  <li>
                    <a
                      href={`mailto:${contacto.email}`}
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Mail className="h-4 w-4" aria-hidden="true" />
                      {contacto.email}
                    </a>
                  </li>
                )}
                {contacto.whatsapp.map((numero) => (
                  <li key={numero}>
                    <a
                      href={enlaceWhatsapp(numero)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      WhatsApp {numero}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form ref={form} onSubmit={enviar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pqrs-tipo">Tipo</Label>
              <select
                id="pqrs-tipo"
                name="tipo"
                required
                defaultValue=""
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  Elige una opción
                </option>
                {TIPOS_PQRS.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_PQRS_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pqrs-asunto">Asunto</Label>
              <Input
                id="pqrs-asunto"
                name="asunto"
                required
                minLength={3}
                maxLength={150}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pqrs-descripcion">Descripción</Label>
              <Textarea
                id="pqrs-descripcion"
                name="descripcion"
                required
                minLength={10}
                maxLength={4000}
                rows={5}
                placeholder="Si es una falla: qué hacías, qué esperabas y qué pasó."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pqrs-imagen">
                Imagen{" "}
                <span className="text-xs text-muted-foreground">
                  (opcional)
                </span>
              </Label>
              <Input
                id="pqrs-imagen"
                name="file"
                type="file"
                accept="image/*"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={enviando}
                onClick={() => setAbierto(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={enviando}
                aria-busy={enviando}
              >
                {enviando && (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                Enviar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
