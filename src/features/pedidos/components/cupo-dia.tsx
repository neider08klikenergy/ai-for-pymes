"use client";

// Cupo de personalizados del día elegido en el calendario: cuántos pedidos
// pagados hay, desde cuándo decide una persona y el tope. El equipo puede
// abrir cupo extra, cerrar cupos o volver al cupo normal de la sede.

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CupoDia } from "../types";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { ajustarCupoDia } from "../services/pedidos-actions";
import { Lock, LockOpen, Plus, RotateCcw } from "lucide-react";

function estadoDe(c: CupoDia): { texto: string; clase: string } {
  if (c.cerrado)
    return {
      texto: "Cupos cerrados",
      clase: "bg-destructive/15 text-destructive",
    };
  if (c.sin_limite)
    return { texto: "Sin límite", clase: "bg-muted text-muted-foreground" };
  if (c.usados >= c.cupo_maximo)
    return { texto: "Sin cupo", clase: "bg-destructive/15 text-destructive" };
  if (c.usados >= c.cupo_automatico)
    return { texto: "Decide el equipo", clase: "bg-warning/15 text-warning" };
  return { texto: "Con cupo", clase: "bg-success/15 text-success" };
}

export function CupoDelDia({
  cupo,
  puedeActuar,
}: {
  cupo: CupoDia;
  puedeActuar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abriendo, setAbriendo] = useState(false);
  const [nuevo, setNuevo] = useState(
    Math.max(cupo.cupo_automatico, cupo.usados) + 1,
  );
  const estado = estadoDe(cupo);

  function guardar(cambio: { cupo: number | null; cerrado: boolean }) {
    startTransition(async () => {
      const r = await ajustarCupoDia({
        sedeId: cupo.sede_id,
        fecha: cupo.fecha,
        ...cambio,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.mensaje);
      setAbriendo(false);
      router.refresh();
    });
  }

  const porcentaje =
    cupo.cupo_maximo > 0
      ? Math.min(100, (cupo.usados / cupo.cupo_maximo) * 100)
      : 0;
  const marca =
    cupo.cupo_maximo > 0 ? (cupo.cupo_automatico / cupo.cupo_maximo) * 100 : 0;

  return (
    <div className="grid gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Cupo de personalizados · {cupo.sede}
        </p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            estado.clase,
          )}
        >
          {estado.texto}
        </span>
      </div>

      {!cupo.sin_limite && (
        <>
          <div
            className="relative h-2 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={cupo.cupo_maximo}
            aria-valuenow={cupo.usados}
            aria-label="Personalizados pagados en el día"
          >
            <div
              className={cn(
                "h-full rounded-full",
                cupo.usados >= cupo.cupo_maximo
                  ? "bg-destructive"
                  : cupo.usados >= cupo.cupo_automatico
                    ? "bg-warning"
                    : "bg-success",
              )}
              style={{ width: `${porcentaje}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-foreground/40"
              style={{ left: `${marca}%` }}
              aria-hidden
            />
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              {cupo.usados}
            </span>{" "}
            pagados · el agente agenda solo hasta{" "}
            <span className="tabular-nums">{cupo.cupo_automatico}</span>
            {cupo.cupo_maximo > cupo.cupo_automatico && (
              <>
                ; de ahí a{" "}
                <span className="tabular-nums">{cupo.cupo_maximo}</span> decide
                el equipo
              </>
            )}
            {cupo.ajustado && " (ajustado para este día)"}.
          </p>
        </>
      )}

      {puedeActuar && (
        <div className="flex flex-wrap items-center gap-2">
          {abriendo ? (
            <>
              <label
                htmlFor={`cupo-${cupo.sede_id}`}
                className="text-xs text-muted-foreground"
              >
                Cupo automático del día
              </label>
              <Input
                id={`cupo-${cupo.sede_id}`}
                type="number"
                min={0}
                className="h-8 w-20"
                value={nuevo}
                onChange={(e) =>
                  setNuevo(Math.max(0, Number(e.target.value) || 0))
                }
              />
              <Button
                size="sm"
                disabled={pendiente}
                onClick={() => guardar({ cupo: nuevo, cerrado: false })}
              >
                Guardar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAbriendo(false)}
              >
                Cancelar
              </Button>
            </>
          ) : (
            <>
              {!cupo.cerrado && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendiente}
                  onClick={() => setAbriendo(true)}
                >
                  <Plus className="h-4 w-4 mr-1.5" aria-hidden />
                  Abrir cupo extra
                </Button>
              )}
              {cupo.cerrado ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendiente}
                  onClick={() =>
                    guardar({
                      cupo: cupo.ajustado ? cupo.cupo_automatico : null,
                      cerrado: false,
                    })
                  }
                >
                  <LockOpen className="h-4 w-4 mr-1.5" aria-hidden />
                  Reabrir cupos
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendiente}
                  onClick={() =>
                    guardar({
                      cupo: cupo.ajustado ? cupo.cupo_automatico : null,
                      cerrado: true,
                    })
                  }
                >
                  <Lock className="h-4 w-4 mr-1.5" aria-hidden />
                  Cerrar cupos
                </Button>
              )}
              {(cupo.ajustado || cupo.cerrado) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pendiente}
                  onClick={() => guardar({ cupo: null, cerrado: false })}
                >
                  <RotateCcw className="h-4 w-4 mr-1.5" aria-hidden />
                  Cupo normal
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
