"use client";


import { useTranslations } from "next-intl";
// Pin opcional de una sede en el mapa (OpenStreetMap + Leaflet: gratis y sin
// API key). Se marca tocando el mapa, arrastrando el pin o buscando la
// dirección. La dirección en texto sigue siendo la principal: esto solo
// agrega el pin que el agente envía por WhatsApp.

import "leaflet/dist/leaflet.css";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { leerCoordenadas, separarPar } from "../lib/ubicacion";

export interface Coordenadas {
  latitud: number;
  longitud: number;
}

interface Props {
  valor: Coordenadas | null;
  onCambiar: (c: Coordenadas | null) => void;
  /** Texto con el que se arranca la búsqueda (la dirección de la sede). */
  direccion: string;
  disabled?: boolean;
}

interface ResultadoBusqueda {
  display_name: string;
  lat: string;
  lon: string;
}

// Sin pin: Colombia completa (primer mercado). Con pin: zoom de calle.
const CENTRO_INICIAL: [number, number] = [4.6, -74.08];
const ZOOM_PAIS = 5;
const ZOOM_CALLE = 17;

function redondear(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function MapaUbicacion({
  valor,
  onCambiar,
  direccion,
  disabled,
}: Props) {
  const t = useTranslations("ui.mapaUbicacion");
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const cambiar = useRef(onCambiar);
  const [busqueda, setBusqueda] = useState(direccion);
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoBusqueda[] | null>(
    null,
  );
  const [borrador, setBorrador] = useState<{
    latitud: string;
    longitud: string;
  } | null>(null);
  const [errorCampos, setErrorCampos] = useState<string | null>(null);

  // Lo que se marca en el mapa (tocar o arrastrar) gana sobre lo que se
  // estuviera escribiendo en los campos.
  useEffect(() => {
    cambiar.current = (c) => {
      setBorrador(null);
      setErrorCampos(null);
      onCambiar(c);
    };
  }, [onCambiar]);

  // Crear el mapa una vez (Leaflet usa window: se importa en el cliente)
  useEffect(() => {
    let cancelado = false;
    void import("leaflet").then(({ default: L }) => {
      if (cancelado || !contenedor.current || mapa.current) return;
      const m = L.map(contenedor.current, { scrollWheelZoom: false }).setView(
        valor ? [valor.latitud, valor.longitud] : CENTRO_INICIAL,
        valor ? ZOOM_CALLE : ZOOM_PAIS,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      mapa.current = m;
      if (!disabled) {
        m.on("click", (e) =>
          cambiar.current({
            latitud: redondear(e.latlng.lat),
            longitud: redondear(e.latlng.lng),
          }),
        );
      }
      // El diálogo anima su tamaño: Leaflet recalcula cuando ya está visible
      setTimeout(() => m.invalidateSize(), 250);
    });
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
      pin.current = null;
    };
    // Solo al montar: los cambios de valor se aplican en el efecto de abajo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantener el pin al día con el valor
  useEffect(() => {
    let cancelado = false;
    void import("leaflet").then(({ default: L }) => {
      const m = mapa.current;
      if (cancelado || !m) return;
      if (!valor) {
        pin.current?.remove();
        pin.current = null;
        return;
      }
      const punto: [number, number] = [valor.latitud, valor.longitud];
      if (pin.current) {
        pin.current.setLatLng(punto);
      } else {
        pin.current = L.marker(punto, {
          draggable: !disabled,
          // Ícono propio: los PNG por defecto de Leaflet no llegan con el bundler
          icon: L.divIcon({
            className: "",
            html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:oklch(var(--destructive));border:2px solid oklch(var(--background));transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 22],
          }),
        }).addTo(m);
        pin.current.on("dragend", () => {
          const p = pin.current?.getLatLng();
          if (p)
            cambiar.current({
              latitud: redondear(p.lat),
              longitud: redondear(p.lng),
            });
        });
      }
    });
    return () => {
      cancelado = true;
    };
  }, [valor, disabled]);

  async function buscar() {
    const q = busqueda.trim();
    if (!q) return;
    setBuscando(true);
    setResultados(null);
    try {
      // Nominatim (OpenStreetMap): búsqueda gratuita; solo al pulsar Buscar
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      setResultados(res.ok ? ((await res.json()) as ResultadoBusqueda[]) : []);
    } catch {
      setResultados([]);
    } finally {
      setBuscando(false);
    }
  }

  // Campos de latitud/longitud: mientras se escribe se guarda un borrador; al
  // salir del campo (o Enter) se valida y se mueve el pin. Sin borrador, los
  // campos muestran el valor actual (lo que se marcó en el mapa).
  const campos = borrador ?? {
    latitud: valor ? String(valor.latitud) : "",
    longitud: valor ? String(valor.longitud) : "",
  };

  function escribir(campo: "latitud" | "longitud", texto: string) {
    setErrorCampos(null);
    // Pegar "4.142, -73.626" en un campo llena los dos
    const par = separarPar(texto);
    setBorrador(par ?? { ...campos, [campo]: texto });
  }

  function confirmar() {
    if (!borrador) return;
    const r = leerCoordenadas(borrador.latitud, borrador.longitud);
    if (r.tipo === "error") {
      // Con un solo campo lleno todavía se está escribiendo: no se marca error
      if (borrador.latitud.trim() && borrador.longitud.trim())
        setErrorCampos(r.mensaje);
      return;
    }
    setBorrador(null);
    if (r.tipo === "vacia") {
      onCambiar(null);
      return;
    }
    onCambiar({ latitud: r.latitud, longitud: r.longitud });
    mapa.current?.setView([r.latitud, r.longitud], ZOOM_CALLE);
  }

  function elegir(r: ResultadoBusqueda) {
    setBorrador(null);
    setErrorCampos(null);
    const c = {
      latitud: redondear(Number(r.lat)),
      longitud: redondear(Number(r.lon)),
    };
    onCambiar(c);
    mapa.current?.setView([c.latitud, c.longitud], ZOOM_CALLE);
    setResultados(null);
  }

  return (
    <div className="grid gap-2">
      {!disabled && (
        <div className="flex gap-1">
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void buscar();
              }
            }}
            placeholder={t("buscarDireccionOLugarEnEl")}
            className="h-8 text-xs"
            aria-label={t("buscarEnElMapa")}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={buscar}
            disabled={buscando || !busqueda.trim()}
          >
            {buscando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}{t("buscar")}</Button>
        </div>
      )}

      {resultados && (
        <ul className="max-h-36 overflow-y-auto rounded-md border text-xs">
          {resultados.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">{t("noSeEncontroPruebaConEl")}</li>
          ) : (
            resultados.map((r) => (
              <li key={`${r.lat},${r.lon}`}>
                <button
                  type="button"
                  onClick={() => elegir(r)}
                  className="w-full px-3 py-2 text-left hover:bg-muted"
                >
                  {r.display_name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <div
        ref={contenedor}
        className="h-56 w-full overflow-hidden rounded-md border bg-muted"
        role="application"
        aria-label={t("mapaTocaParaMarcarLaUbicacion")}
      />

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="mapa-lat" className="text-xs">{t("latitud")}</Label>
          <Input
            id="mapa-lat"
            inputMode="decimal"
            value={campos.latitud}
            disabled={disabled}
            onChange={(e) => escribir("latitud", e.target.value)}
            onBlur={confirmar}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.preventDefault(), confirmar())
            }
            placeholder="4.142000"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="mapa-lng" className="text-xs">{t("longitud")}</Label>
          <Input
            id="mapa-lng"
            inputMode="decimal"
            value={campos.longitud}
            disabled={disabled}
            onChange={(e) => escribir("longitud", e.target.value)}
            onBlur={confirmar}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.preventDefault(), confirmar())
            }
            placeholder="-73.626000"
            className="h-8 font-mono text-xs"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        {errorCampos ? (
          <span className="text-destructive" role="alert">
            {errorCampos}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {valor
              ? t("puedesPegarEnLatitudElPar")
              : t("sinUbicacionElAgenteEnviaraSolo")}
          </span>
        )}
        {valor && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => {
              setBorrador(null);
              setErrorCampos(null);
              onCambiar(null);
            }}
          >
            <X className="h-3 w-3" aria-hidden="true" />{t("quitar")}</Button>
        )}
      </div>
    </div>
  );
}
