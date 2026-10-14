// Lo que ve el equipo de un workspace suspendido por Felrick: un aviso
// genérico (sin el motivo) y cómo contactar a soporte.

import {
  enlaceWhatsapp,
  type ContactoSoporte,
} from "@/features/plataforma/lib/perfil";
import { Mail, MessageCircle, PauseCircle } from "lucide-react";

export function WorkspaceSuspendido({
  nombre,
  contacto,
}: {
  nombre: string | null;
  contacto: ContactoSoporte;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <section
        aria-labelledby="suspendido-titulo"
        className="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 text-center"
      >
        <PauseCircle
          className="mx-auto h-10 w-10 text-muted-foreground"
          aria-hidden="true"
        />
        <h1 id="suspendido-titulo" className="mt-3 text-lg font-semibold">
          {nombre
            ? `${nombre} está suspendido`
            : "Este workspace está suspendido"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Por ahora no puedes usar el panel y el agente no está respondiendo. Tu
          información y los mensajes de tus clientes están guardados. Para
          reactivarlo, comunícate con nuestro equipo.
        </p>

        {(contacto.email || contacto.whatsapp.length > 0) && (
          <ul className="mt-5 space-y-2 text-sm">
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
        )}
      </section>
    </main>
  );
}
