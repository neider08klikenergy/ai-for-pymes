"use client";


import { useTranslations } from "next-intl";
// Panel de agencia → Solicitudes de demo. El equipo de Felrick ve quién pidió
// la demo, sus datos y lleva el seguimiento (estado, fecha de la demo, notas).

import {
  ESTADOS,
  type Canal,
  CANAL_LABEL,
  ESTADO_LABEL,
  MENSAJES_LABEL,
  type EstadoSolicitud,
} from "../lib/solicitud";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { Textarea } from "@/components/ui/textarea";
import { actualizarSolicitud } from "../services/solicitudes-actions";
import { CalendarCheck, Inbox, Mail, MessageCircle } from "lucide-react";

export interface SolicitudFila {
  id: string;
  nombre: string;
  empresa: string;
  correo: string;
  whatsapp: string;
  sector: string | null;
  ciudad: string | null;
  sedes: number | null;
  canales: Canal[];
  usa_shopify: boolean | null;
  mensajes_dia: keyof typeof MENSAJES_LABEL | null;
  comentario: string | null;
  estado: EstadoSolicitud;
  notas: string | null;
  demo_at: string | null;
  created_at: string;
}

const COLOR: Record<EstadoSolicitud, string> = {
  nueva: "bg-primary/15 text-primary",
  contactada: "bg-info/15 text-info",
  agendada: "bg-warning/15 text-warning",
  demo_hecha: "bg-accent text-accent-foreground",
  cliente: "bg-success/15 text-success",
  descartada: "bg-muted text-muted-foreground",
};

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function fecha(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** ISO → valor de <input type="datetime-local"> en la hora del navegador. */
function aLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Enlace de WhatsApp con solo los dígitos del número. */
function enlaceWa(numero: string): string {
  return `https://wa.me/${numero.replace(/\D/g, "")}`;
}

export function SolicitudesPanel({
  solicitudes,
}: {
  solicitudes: SolicitudFila[];
}) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.solicitudesPanel");
  const [filtro, setFiltro] = useState<EstadoSolicitud | "activas">("activas");
  const visibles = solicitudes.filter((s) =>
    filtro === "activas"
      ? !["cliente", "descartada"].includes(s.estado)
      : s.estado === filtro,
  );
  const cuenta = (e: EstadoSolicitud) =>
    solicitudes.filter((s) => s.estado === e).length;

  return (
    <div className="mx-auto w-full max-w-5xl flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-semibold flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-primary" aria-hidden="true" />{t("solicitudesDeDemo")}</h1>
        <p className="text-sm text-muted-foreground">{t("negociosQuePidieronUnaDemoDesde")}</p>
      </div>

      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label={t("filtrarPorEstado")}
      >
        <Button
          size="sm"
          variant={filtro === "activas" ? "default" : "outline"}
          onClick={() => setFiltro("activas")}
        >{t("enCurso")}</Button>
        {ESTADOS.map((e) => (
          <Button
            key={e}
            size="sm"
            variant={filtro === e ? "default" : "outline"}
            onClick={() => setFiltro(e)}
          >
            {tc(ESTADO_LABEL[e])}
            <span className="ml-1 tabular-nums opacity-70">{cuenta(e)}</span>
          </Button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <Inbox className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{t("noHaySolicitudesAqui")}</p>
          <p className="text-sm text-muted-foreground">{t("comparteElEnlace")}{" "}<span className="font-mono">/demo</span>{" "}{t("paraQueLosNegociosPidanSu")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibles.map((s) => (
            <TarjetaSolicitud
              key={`${s.id}:${s.estado}:${s.demo_at}:${s.notas}`}
              solicitud={s}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TarjetaSolicitud({ solicitud: s }: { solicitud: SolicitudFila }) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.solicitudesPanel");
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoSolicitud>(s.estado);
  const [notas, setNotas] = useState(s.notas ?? "");
  const [demoAt, setDemoAt] = useState(aLocal(s.demo_at));
  const [pendiente, startTransition] = useTransition();
  const cambiado =
    estado !== s.estado ||
    notas !== (s.notas ?? "") ||
    demoAt !== aLocal(s.demo_at);

  function guardar() {
    startTransition(async () => {
      const r = await actualizarSolicitud({
        id: s.id,
        estado,
        notas,
        demo_at: demoAt ? new Date(demoAt).toISOString() : null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("solicitudActualizada"));
      router.refresh();
    });
  }

  const datos = [
    s.sector,
    s.ciudad,
    s.sedes && `${s.sedes} ${s.sedes === 1 ? "sede" : "sedes"}`,
    s.canales.length > 0 && s.canales.map((c) => CANAL_LABEL[c]).join(", "),
    s.usa_shopify !== null && (s.usa_shopify ? "Usa Shopify" : "Sin Shopify"),
    s.mensajes_dia && `${MENSAJES_LABEL[s.mensajes_dia]} mensajes/día`,
  ].filter(Boolean);

  return (
    <li className="rounded-xl border bg-card p-4 grid gap-4 md:grid-cols-[1fr_280px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{s.empresa}</p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              COLOR[s.estado],
            )}
          >
            {tc(ESTADO_LABEL[s.estado])}
          </span>
          <span className="text-xs text-muted-foreground">
            · {fecha(s.created_at)}
          </span>
        </div>
        <p className="text-sm">{s.nombre}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a
            href={enlaceWa(s.whatsapp)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-mono">{s.whatsapp}</span>
          </a>
          <a
            href={`mailto:${s.correo}`}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            {s.correo}
          </a>
        </div>
        {datos.length > 0 && (
          <p className="text-xs text-muted-foreground">{datos.join(" · ")}</p>
        )}
        {s.comentario && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">
            {s.comentario}
          </p>
        )}
      </div>

      <div className="grid gap-2 content-start">
        <div className="grid gap-1">
          <Label htmlFor={`est-${s.id}`} className="text-xs">{t("estado")}</Label>
          <select
            id={`est-${s.id}`}
            className={SELECT_CLASS}
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoSolicitud)}
          >
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {tc(ESTADO_LABEL[e])}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`demo-${s.id}`} className="text-xs">{t("fechaDeLaDemo")}</Label>
          <Input
            id={`demo-${s.id}`}
            type="datetime-local"
            value={demoAt}
            onChange={(e) => setDemoAt(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`notas-${s.id}`} className="text-xs">{t("notasInternas")}</Label>
          <Textarea
            id={`notas-${s.id}`}
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </div>
        <Button size="sm" disabled={!cambiado || pendiente} onClick={guardar}>{t("guardar")}</Button>
      </div>
    </li>
  );
}
