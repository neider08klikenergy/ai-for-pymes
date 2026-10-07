"use client";

// Página pública "Agenda una demo": 1) formulario corto (se guarda como
// solicitud aunque no terminen de agendar) y 2) calendario de Cal.com con los
// datos precargados. Sin enlace de Cal.com configurado, el paso 2 avisa que
// el equipo se comunicará.

import {
  CANALES,
  type Canal,
  primerError,
  CANAL_LABEL,
  MENSAJES_DIA,
  MENSAJES_LABEL,
  SolicitudSchema,
  notasParaCalcom,
  type SolicitudDatos,
} from "../lib/solicitud";
import Link from "next/link";
import { cn } from "@/lib/utils";
import Cal from "@calcom/embed-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { CalendarCheck, CheckCircle2, Loader2 } from "lucide-react";
import { crearSolicitudDemo } from "../services/solicitudes-actions";

interface Props {
  /** Enlace de Cal.com ("felrick/demo"), o null si aún no hay cuenta. */
  calLink: string | null;
}

type Form = {
  nombre: string;
  empresa: string;
  correo: string;
  whatsapp: string;
  sector: string;
  ciudad: string;
  sedes: string;
  canales: Canal[];
  usa_shopify: "" | "si" | "no";
  mensajes_dia: string;
  comentario: string;
  sitio_web: string;
};

const VACIO: Form = {
  nombre: "",
  empresa: "",
  correo: "",
  whatsapp: "",
  sector: "",
  ciudad: "",
  sedes: "",
  canales: ["whatsapp"],
  usa_shopify: "",
  mensajes_dia: "",
  comentario: "",
  sitio_web: "",
};

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Campo({
  id,
  label,
  children,
  opcional,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  opcional?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {opcional && (
          <span className="ml-1 font-normal text-muted-foreground">
            (opcional)
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

export function SolicitudDemo({ calLink }: Props) {
  const [form, setForm] = useState<Form>(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState<SolicitudDatos | null>(null);
  const [pendiente, startTransition] = useTransition();
  const set = (c: Partial<Form>) => setForm((f) => ({ ...f, ...c }));

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const entrada = {
      ...form,
      usa_shopify: form.usa_shopify === "" ? null : form.usa_shopify === "si",
    };
    // Se valida aquí también para mostrar el error sin ir al servidor
    const local = SolicitudSchema.safeParse(entrada);
    if (!local.success) {
      setError(primerError(local.error));
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await crearSolicitudDemo(entrada);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEnviada(local.data);
    });
  }

  if (enviada) {
    return (
      <div className="w-full max-w-3xl space-y-4">
        <div className="glass rounded-xl p-6 flex items-start gap-3">
          <CheckCircle2
            className="h-5 w-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="font-medium">
              ¡Gracias, {enviada.nombre.split(" ")[0]}! Recibimos tus datos.
            </p>
            <p className="text-sm text-muted-foreground">
              {calLink
                ? "Ahora elige el día y la hora de tu demo."
                : `Te escribiremos al WhatsApp ${enviada.whatsapp} para acordar el día y la hora de tu demo.`}
            </p>
          </div>
        </div>
        {calLink && (
          <div className="glass rounded-xl overflow-hidden">
            <Cal
              calLink={calLink}
              style={{
                width: "100%",
                height: "100%",
                minHeight: 640,
                overflow: "auto",
              }}
              config={{
                name: enviada.nombre,
                email: enviada.correo,
                notes: notasParaCalcom(enviada),
                theme: "auto",
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="glass rounded-xl p-6 sm:p-8 w-full max-w-xl space-y-5"
      noValidate
    >
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight flex items-center gap-2">
          <CalendarCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          Agenda una demo
        </h1>
        <p className="text-sm text-muted-foreground">
          Cuéntanos de tu negocio y te mostramos cómo el agente atiende a tus
          clientes. Toma 1 minuto.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="d-nombre" label="Tu nombre">
          <Input
            id="d-nombre"
            autoComplete="name"
            value={form.nombre}
            onChange={(e) => set({ nombre: e.target.value })}
          />
        </Campo>
        <Campo id="d-empresa" label="Negocio">
          <Input
            id="d-empresa"
            autoComplete="organization"
            value={form.empresa}
            onChange={(e) => set({ empresa: e.target.value })}
          />
        </Campo>
        <Campo id="d-correo" label="Correo">
          <Input
            id="d-correo"
            type="email"
            autoComplete="email"
            value={form.correo}
            onChange={(e) => set({ correo: e.target.value })}
          />
        </Campo>
        <Campo id="d-wa" label="WhatsApp">
          <Input
            id="d-wa"
            type="tel"
            autoComplete="tel"
            placeholder="+57 300 000 0000"
            value={form.whatsapp}
            onChange={(e) => set({ whatsapp: e.target.value })}
          />
        </Campo>
        <Campo id="d-sector" label="Sector" opcional>
          <Input
            id="d-sector"
            placeholder="Pastelería, restaurante, hotel…"
            value={form.sector}
            onChange={(e) => set({ sector: e.target.value })}
          />
        </Campo>
        <Campo id="d-ciudad" label="Ciudad" opcional>
          <Input
            id="d-ciudad"
            value={form.ciudad}
            onChange={(e) => set({ ciudad: e.target.value })}
          />
        </Campo>
        <Campo id="d-sedes" label="Número de sedes" opcional>
          <Input
            id="d-sedes"
            type="number"
            inputMode="numeric"
            min={1}
            value={form.sedes}
            onChange={(e) => set({ sedes: e.target.value })}
          />
        </Campo>
        <Campo id="d-mensajes" label="Mensajes al día" opcional>
          <select
            id="d-mensajes"
            className={SELECT_CLASS}
            value={form.mensajes_dia}
            onChange={(e) => set({ mensajes_dia: e.target.value })}
          >
            <option value="">Selecciona</option>
            {MENSAJES_DIA.map((m) => (
              <option key={m} value={m}>
                {MENSAJES_LABEL[m]}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">
          ¿Por dónde te escriben tus clientes?
        </legend>
        <div className="flex flex-wrap gap-4">
          {CANALES.map((c) => (
            <label
              key={c}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={form.canales.includes(c)}
                onCheckedChange={(v) =>
                  set({
                    canales: v
                      ? [...form.canales, c]
                      : form.canales.filter((x) => x !== c),
                  })
                }
              />
              {CANAL_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">¿Vendes en Shopify?</legend>
        <div className="flex gap-2" role="radiogroup">
          {(
            [
              ["si", "Sí"],
              ["no", "No"],
            ] as const
          ).map(([v, label]) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={form.usa_shopify === v ? "default" : "outline"}
              role="radio"
              aria-checked={form.usa_shopify === v}
              onClick={() =>
                set({ usa_shopify: form.usa_shopify === v ? "" : v })
              }
            >
              {label}
            </Button>
          ))}
        </div>
      </fieldset>

      <Campo id="d-comentario" label="¿Algo más que debamos saber?" opcional>
        <Textarea
          id="d-comentario"
          rows={3}
          value={form.comentario}
          onChange={(e) => set({ comentario: e.target.value })}
        />
      </Campo>

      {/* Trampa para bots: oculta para personas y lectores de pantalla */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="d-web">Sitio web</label>
        <input
          id="d-web"
          tabIndex={-1}
          autoComplete="off"
          value={form.sitio_web}
          onChange={(e) => set({ sitio_web: e.target.value })}
        />
      </div>

      {error && (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pendiente}>
        {pendiente && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {calLink ? "Continuar y elegir la hora" : "Solicitar demo"}
      </Button>

      <p className={cn("text-center text-sm text-muted-foreground")}>
        ¿Ya eres cliente?{" "}
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline"
        >
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}
