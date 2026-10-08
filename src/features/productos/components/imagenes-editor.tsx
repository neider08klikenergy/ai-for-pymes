"use client";


import { useTranslations } from "next-intl";
// Fotos de un producto: se suben al bucket propio o se pega un enlace
// (https). La primera es la principal. Las fotos se suben al elegirlas, para
// mostrarlas al instante; las que no se guardan las limpia quien abre el
// editor (ver CatalogoProductos).

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { prepareImage } from "@/features/inbox/lib/prepare-image";
import { ImageOff, ImagePlus, Link2, Loader2, Star, X } from "lucide-react";
import { BUCKET_IMAGENES, MAX_IMAGENES, rutaNuevaImagen } from "../lib/imagenes";

interface Props {
  workspaceId: string;
  imagenes: string[];
  onCambiar: (imagenes: string[]) => void;
  /** Avisa cada foto subida en esta edición (para borrarla si no se guarda). */
  onSubida: (url: string) => void;
}

export function ImagenesEditor({ workspaceId, imagenes, onCambiar, onSubida }: Props) {
  const t = useTranslations("ui.imagenesEditor");
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(0);
  const [enlace, setEnlace] = useState("");
  const [rotas, setRotas] = useState<Set<string>>(new Set());
  const lleno = imagenes.length >= MAX_IMAGENES;

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    const lista = Array.from(archivos).slice(0, MAX_IMAGENES - imagenes.length);
    if (lista.length < archivos.length) toast.warning(`Máximo ${MAX_IMAGENES} fotos por producto`);

    const supabase = createClient();
    let actuales = imagenes;
    setSubiendo(lista.length);
    for (const archivo of lista) {
      const preparada = await prepareImage(archivo);
      if ("error" in preparada) {
        toast.error(`${archivo.name}: ${preparada.error}`);
        setSubiendo((n) => n - 1);
        continue;
      }
      const ruta = rutaNuevaImagen(workspaceId, crypto.randomUUID(), preparada.type);
      const { error } = await supabase.storage
        .from(BUCKET_IMAGENES)
        .upload(ruta, preparada, { contentType: preparada.type, cacheControl: "31536000", upsert: false });
      setSubiendo((n) => n - 1);
      if (error) {
        console.error("[productos] subir foto:", error.message);
        toast.error(`No se pudo subir ${archivo.name}`);
        continue;
      }
      const url = supabase.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta).data.publicUrl;
      onSubida(url);
      actuales = [...actuales, url];
      onCambiar(actuales);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function agregarEnlace() {
    const url = enlace.trim();
    if (!url) return;
    if (!/^https:\/\/\S+$/.test(url)) {
      toast.error(t("elEnlaceDebeEmpezarPorHttps"));
      return;
    }
    if (imagenes.includes(url)) {
      toast.error(t("eseEnlaceYaEsta"));
      return;
    }
    onCambiar([...imagenes, url]);
    setEnlace("");
  }

  function quitar(url: string) {
    onCambiar(imagenes.filter((u) => u !== url));
  }

  function hacerPrincipal(url: string) {
    onCambiar([url, ...imagenes.filter((u) => u !== url)]);
  }

  return (
    <div className="grid gap-2">
      {imagenes.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {imagenes.map((url, i) => (
            <li key={url} className="group relative h-20 w-20 overflow-hidden rounded-lg border bg-muted">
              {rotas.has(url) ? (
                <span className="flex h-full w-full items-center justify-center" title={t("noSePudoCargar")}>
                  <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={i === 0 ? t("fotoPrincipal") : `Foto ${i + 1}`}
                  className="h-full w-full object-cover"
                  onError={() => setRotas((s) => new Set(s).add(url))}
                />
              )}
              {i === 0 && (
                <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-medium">{t("principal")}</span>
              )}
              <div className="absolute right-1 top-1 flex gap-1">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => hacerPrincipal(url)}
                    className="rounded-full bg-background/90 p-1 shadow-sm hover:bg-background"
                    aria-label={`Usar la foto ${i + 1} como principal`}
                    title={t("usarComoPrincipal")}
                  >
                    <Star className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => quitar(url)}
                  className="rounded-full bg-background/90 p-1 shadow-sm hover:bg-background"
                  aria-label={`Quitar la foto ${i + 1}`}
                  title={t("quitar")}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => subir(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={lleno || subiendo > 0}
          onClick={() => inputRef.current?.click()}
        >
          {subiendo > 0 ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
          )}
          {subiendo > 0 ? `Subiendo ${subiendo}…` : t("subirFotos")}
        </Button>
        <div className={cn("flex min-w-[220px] flex-1 items-center gap-1", lleno && "opacity-50")}>
          <Input
            value={enlace}
            disabled={lleno}
            onChange={(e) => setEnlace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregarEnlace();
              }
            }}
            placeholder={t("oPegaUnEnlaceHttps")}
            className="h-8 text-xs"
            aria-label={t("enlaceDeUnaImagen")}
          />
          <Button type="button" variant="ghost" size="sm" disabled={lleno || !enlace.trim()} onClick={agregarEnlace}>
            <Link2 className="h-4 w-4" aria-hidden="true" />{t("agregar")}</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("laPrimeraEsLaPrincipalLas")}{" "}{MAX_IMAGENES}.
      </p>
    </div>
  );
}
