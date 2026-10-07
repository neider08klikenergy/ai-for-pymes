// Ubicación de una sede para enviarla por el chat. La dirección en texto es
// la principal; las coordenadas (marcadas en el mapa del panel) son opcionales.

export interface UbicacionSede {
  sede: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
}

/** Coordenada válida o null (Postgres devuelve NUMERIC como texto o número). */
export function coordenada(v: unknown, limite: 90 | 180): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limite ? n : null;
}

/** Número escrito a mano: acepta coma decimal ("4,142") si no hay punto. */
function numeroEscrito(t: string): number | null {
  const s = t.trim().replace(/\s+/g, "");
  if (!s) return null;
  const normal = s.includes(".") ? s : s.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : null;
}

/**
 * El par que copia Google Maps ("4.142000, -73.626000"), o null si el texto
 * no es un par. Solo con punto decimal: la coma separa los dos números.
 */
export function separarPar(t: string): { latitud: string; longitud: string } | null {
  const m = t.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  return m && t.includes(".") ? { latitud: m[1], longitud: m[2] } : null;
}

export type LecturaCoordenadas =
  | { tipo: "vacia" }
  | { tipo: "ok"; latitud: number; longitud: number }
  | { tipo: "error"; mensaje: string };

/** Lo que se escribió en los campos de latitud y longitud. */
export function leerCoordenadas(latitud: string, longitud: string): LecturaCoordenadas {
  if (!latitud.trim() && !longitud.trim()) return { tipo: "vacia" };
  const lat = numeroEscrito(latitud);
  const lng = numeroEscrito(longitud);
  if (lat === null || lng === null) {
    return { tipo: "error", mensaje: "Escribe la latitud y la longitud como números, ej: 4.142 y -73.626" };
  }
  if (Math.abs(lat) > 90) return { tipo: "error", mensaje: "La latitud va entre -90 y 90" };
  if (Math.abs(lng) > 180) return { tipo: "error", mensaje: "La longitud va entre -180 y 180" };
  return { tipo: "ok", latitud: Math.round(lat * 1e6) / 1e6, longitud: Math.round(lng * 1e6) / 1e6 };
}

/** Enlace de Google Maps a las coordenadas (abre la app en el celular). */
export function enlaceMaps(latitud: number, longitud: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitud},${longitud}`;
}

/**
 * Texto que ve el cliente cuando no hay pin nativo (Instagram, Facebook, o
 * una sede sin coordenadas) y que queda en el hilo del inbox.
 */
export function textoUbicacion(u: UbicacionSede): string {
  const lineas = [`📍 *${u.sede}*`];
  if (u.direccion) lineas.push(u.direccion);
  if (u.latitud !== null && u.longitud !== null) lineas.push(enlaceMaps(u.latitud, u.longitud));
  return lineas.join("\n");
}
