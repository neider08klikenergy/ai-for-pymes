"use client";

// Cupo de personalizados del día elegido en el calendario: cuántos pedidos
// pagados hay, desde cuándo decide una persona y el tope. El equipo puede
// abrir cupo extra, cerrar cupos o volver al cupo normal de la sede.

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CupoDia } from "../types";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { ajustarCupoDia } from "../services/pedidos-actions";
import { Lock, LockOpen, Plus, RotateCcw } from "lucide-react";

// texto: clave de pedidos.cupo.estado.*
function estadoDe(c: CupoDia): { texto: string; clase: string } {
  if (c.cerrado)
    return {
      texto: "cerrados",
      clase: "bg-destructive/15 text-destructive",
    };
  if (c.sin_limite)
    return { texto: "sinLimite", clase: "bg-muted text-muted-foreground" };
  if (c.usados >= c.cupo_maximo)
    return { texto: "sinCupo", clase: "bg-destructive/15 text-destructive" };
  if (c.usados >= c.cupo_automatico)
    return { texto: "decideEquipo", clase: "bg-warning/15 text-warning" };
  return { texto: "conCupo", clase: "bg-success/15 text-success" };
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
  const t = useTranslations("pedidos.cupo");

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
          {t("titulo", { sede: cupo.sede })}
        </p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            estado.clase,
          )}
        >
          {t(`estado.${estado.texto}` as "estado.conCupo")}
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
            aria-label={t("medidor")}
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
            {t.rich(
              cupo.cupo_maximo > cupo.cupo_automatico
                ? "resumenConRevision"
                : "resumen",
              {
                usados: cupo.usados,
                automatico: cupo.cupo_automatico,
                maximo: cupo.cupo_maximo,
                fuerte: (c) => (
                  <span className="font-semibold text-foreground tabular-nums">
                    {c}
                  </span>
                ),
                num: (c) => <span className="tabular-nums">{c}</span>,
              },
            )}
            {cupo.ajustado && ` ${t("ajustado")}`}.
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
                {t("cupoAutomatico")}
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
                {t("guardar")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAbriendo(false)}
              >
                {t("cancelar")}
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
                  {t("abrirExtra")}
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
                  {t("reabrir")}
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
                  {t("cerrar")}
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
                  {t("normal")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
