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
