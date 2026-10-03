"use client";

// "Mis avisos por correo" en Settings → Equipo. Cada persona decide si recibe
// los avisos del workspace por correo y de qué tipos.

import {
  enviarCorreoPrueba,
  leerPreferenciasCorreo,
  guardarPreferenciasCorreo,
  type PreferenciasCorreoVista,
} from "../services/preferencias-actions";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, Send } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState, useTransition } from "react";
import { TIPOS_CORREO, TIPO_CORREO_INFO, type TipoCorreo } from "../lib/tipos";

export function PreferenciasCorreo({ workspaceId }: { workspaceId: string }) {
  const [vista, setVista] = useState<
    PreferenciasCorreoVista | null | undefined
  >(undefined);
  const [activo, setActivo] = useState(false);
  const [tipos, setTipos] = useState<TipoCorreo[]>([]);
  const [guardando, startGuardar] = useTransition();
  const [probando, startProbar] = useTransition();

  useEffect(() => {
    let vivo = true;
    void leerPreferenciasCorreo(workspaceId).then((v) => {
      if (!vivo) return;
      setVista(v);
      if (v) {
        setActivo(v.activo);
        setTipos(v.tipos);
      }
    });
    return () => {
      vivo = false;
    };
  }, [workspaceId]);

  const cambios = vista
    ? activo !== vista.activo ||
      tipos.length !== vista.tipos.length ||
      tipos.some((t) => !vista.tipos.includes(t))
    : false;

  function alternarTipo(t: TipoCorreo, on: boolean) {
    setTipos((prev) =>
      on ? [...new Set([...prev, t])] : prev.filter((x) => x !== t),
    );
  }

  function guardar() {
    startGuardar(async () => {
      const r = await guardarPreferenciasCorreo(workspaceId, { activo, tipos });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setVista((v) => (v ? { ...v, activo, tipos } : v));
      toast.success(
        activo
          ? "Avisos por correo activados"
          : "Avisos por correo desactivados",
      );
    });
  }

  function probar() {
    startProbar(async () => {
      const r = await enviarCorreoPrueba(workspaceId);
      if (r.ok)
        toast.success(
          `Correo de prueba enviado a ${vista?.email ?? "tu correo"}`,
        );
      else toast.error(r.error);
    });
  }

  if (vista === undefined) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (vista === null) return null;

  return (
    <section
      className="grid gap-4 rounded-lg border border-border/60 p-4"
      aria-labelledby="pref-correo-titulo"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <Mail
            className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <h3 id="pref-correo-titulo" className="text-sm font-semibold">
              Mis avisos por correo
            </h3>
            <p className="text-xs text-muted-foreground">
              Recibe en {vista.email ?? "tu correo"} los avisos de la campana.
              Solo te llegan a ti; cada persona del equipo elige los suyos.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={activo}
            onCheckedChange={setActivo}
            aria-label="Recibir avisos por correo"
          />
          {activo ? "Activados" : "Desactivados"}
        </label>
      </div>

      {!vista.configurado && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          Los correos aún no están configurados en la plataforma (falta
          EMAIL_FROM y la API key del proveedor). Puedes dejar tus preferencias
          listas.
        </p>
      )}

      <fieldset className="grid gap-2.5 sm:grid-cols-2" disabled={!activo}>
        <legend className="sr-only">Tipos de aviso</legend>
        {TIPOS_CORREO.map((t) => {
          const id = `correo-${t}`;
          return (
            <label
              key={t}
              htmlFor={id}
              className={`flex cursor-pointer items-start gap-2 rounded-md border border-border/50 p-2.5 ${activo ? "" : "opacity-50"}`}
            >
              <Checkbox
                id={id}
                checked={tipos.includes(t)}
                onCheckedChange={(v) => alternarTipo(t, v === true)}
                className="mt-0.5"
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">
                  {TIPO_CORREO_INFO[t].label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {TIPO_CORREO_INFO[t].descripcion}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={guardar}
          disabled={!cambios || guardando}
        >
          {guardando && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
          )}
          Guardar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={probar}
          disabled={probando || !vista.configurado}
        >
          {probando ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          Enviarme un correo de prueba
        </Button>
        {activo && tipos.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Elige al menos un tipo de aviso.
          </span>
        )}
      </div>
    </section>
  );
}
