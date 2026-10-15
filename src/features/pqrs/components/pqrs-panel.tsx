"use client";

// Agencia → PQRS: lo que reportan los workspaces. El equipo de Falvrick lee el
// detalle (con la imagen y el contexto) y cambia el estado.

import {
  ESTADOS_PQRS,
  type TipoPqrs,
  TIPO_PQRS_LABEL,
  type EstadoPqrs,
  ESTADO_PQRS_LABEL,
} from "../lib/pqrs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { ImageIcon, Inbox, LifeBuoy, Mail } from "lucide-react";
import { actualizarEstadoPqrs } from "../services/pqrs-actions";

export interface PqrsFila {
  id: string;
  tipo: TipoPqrs;
  asunto: string;
  descripcion: string;
  estado: EstadoPqrs;
  created_at: string;
  contexto: {
    pagina?: string | null;
    navegador?: string | null;
    version?: string | null;
  };
  workspace: string;
  autor: string;
  autorEmail: string | null;
  imagenUrl: string | null;
}

const COLOR: Record<EstadoPqrs, string> = {
  abierta: "bg-primary/15 text-primary",
  en_progreso: "bg-warning/15 text-warning",
  resuelta: "bg-success/15 text-success",
  descartada: "bg-muted text-muted-foreground",
};

const SELECT_CLASS =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function fecha(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function PqrsPanel({ pqrs }: { pqrs: PqrsFila[] }) {
  const [filtro, setFiltro] = useState<EstadoPqrs | "pendientes">("pendientes");
  const visibles = pqrs.filter((p) =>
    filtro === "pendientes"
      ? p.estado === "abierta" || p.estado === "en_progreso"
      : p.estado === filtro,
  );
  const cuenta = (e: EstadoPqrs) => pqrs.filter((p) => p.estado === e).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold">
          <LifeBuoy className="h-5 w-5 text-primary" aria-hidden="true" />
          PQRS
        </h1>
        <p className="text-sm text-muted-foreground">
          Peticiones, quejas, reclamos, sugerencias y fallas que reportan los
          workspaces.
        </p>
      </div>

      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Filtrar por estado"
      >
        <Button
          size="sm"
          variant={filtro === "pendientes" ? "default" : "outline"}
          onClick={() => setFiltro("pendientes")}
        >
          Pendientes
        </Button>
        {ESTADOS_PQRS.map((e) => (
          <Button
            key={e}
            size="sm"
            variant={filtro === e ? "default" : "outline"}
            onClick={() => setFiltro(e)}
          >
            {ESTADO_PQRS_LABEL[e]}
            <span className="ml-1 tabular-nums opacity-70">{cuenta(e)}</span>
          </Button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <Inbox className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">No hay PQRS aquí</p>
          <p className="text-sm text-muted-foreground">
            Los workspaces las envían desde el botón Soporte de la barra
            superior.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibles.map((p) => (
            <TarjetaPqrs key={`${p.id}:${p.estado}`} pqrs={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TarjetaPqrs({ pqrs: p }: { pqrs: PqrsFila }) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoPqrs>(p.estado);
  const [guardando, startGuardar] = useTransition();

  function cambiar(nuevo: EstadoPqrs) {
    const anterior = estado;
    setEstado(nuevo);
    startGuardar(async () => {
      const r = await actualizarEstadoPqrs({ id: p.id, estado: nuevo });
      if (!r.ok) {
        setEstado(anterior);
        toast.error(r.error);
        return;
      }
      toast.success(`Marcada como ${ESTADO_PQRS_LABEL[nuevo].toLowerCase()}`);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">
              {TIPO_PQRS_LABEL[p.tipo]}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                COLOR[estado],
              )}
            >
              {ESTADO_PQRS_LABEL[estado]}
            </span>
            <span className="text-muted-foreground">{fecha(p.created_at)}</span>
          </div>
          <h2 className="mt-1.5 font-semibold">{p.asunto}</h2>
          <p className="text-sm text-muted-foreground">
            {p.workspace} · {p.autor}
            {p.autorEmail && (
              <a
                href={`mailto:${p.autorEmail}?subject=${encodeURIComponent(`Re: ${p.asunto}`)}`}
                className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                Escribirle
              </a>
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Estado</span>
          <select
            className={SELECT_CLASS}
            value={estado}
            disabled={guardando}
            onChange={(e) => cambiar(e.target.value as EstadoPqrs)}
          >
            {ESTADOS_PQRS.map((e) => (
              <option key={e} value={e}>
                {ESTADO_PQRS_LABEL[e]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="whitespace-pre-wrap text-sm">{p.descripcion}</p>

      {p.imagenUrl && (
        <a
          href={p.imagenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          Ver imagen adjunta
        </a>
      )}

      <p className="text-xs text-muted-foreground">
        Página: <span className="font-mono">{p.contexto.pagina ?? "—"}</span>
        {" · "}Versión:{" "}
        <span className="font-mono">{p.contexto.version ?? "—"}</span>
        {p.contexto.navegador && (
          <>
            {" · "}
            <span title={p.contexto.navegador}>
              {p.contexto.navegador.slice(0, 80)}
            </span>
          </>
        )}
      </p>
    </li>
  );
}
