"use client";

// Pin opcional de una sede en el mapa (OpenStreetMap + Leaflet: gratis y sin
// API key). Se marca tocando el mapa, arrastrando el pin o buscando la
// dirección. La dirección en texto sigue siendo la principal: esto solo
// agrega el pin que el agente envía por WhatsApp.

import "leaflet/dist/leaflet.css";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Loader2, MapPin, Search, X } from "lucide-react";

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
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const cambiar = useRef(onCambiar);
  const [busqueda, setBusqueda] = useState(direccion);
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoBusqueda[] | null>(
    null,
  );

  useEffect(() => {
    cambiar.current = onCambiar;
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

  function elegir(r: ResultadoBusqueda) {
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
            placeholder="Buscar dirección o lugar en el mapa"
            className="h-8 text-xs"
            aria-label="Buscar en el mapa"
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
            )}
            Buscar
          </Button>
        </div>
      )}

      {resultados && (
        <ul className="max-h-36 overflow-y-auto rounded-md border text-xs">
          {resultados.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">
              No se encontró. Prueba con el barrio o la ciudad, o toca el mapa
              para marcar.
            </li>
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
        aria-label="Mapa: toca para marcar la ubicación de la sede"
      />

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" aria-hidden="true" />
          {valor
            ? `${valor.latitud}, ${valor.longitud}`
            : "Sin ubicación: el agente enviará solo la dirección en texto"}
        </span>
        {valor && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => onCambiar(null)}
          >
            <X className="h-3 w-3" aria-hidden="true" />
            Quitar
          </Button>
        )}
      </div>
    </div>
  );
}
