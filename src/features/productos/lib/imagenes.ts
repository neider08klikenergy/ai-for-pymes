// Fotos de productos. productos.imagenes es una lista de URLs que mezcla:
//  - fotos subidas desde el panel al bucket público 'productos-imagenes'
//  - enlaces externos (pegados a mano o importados de Shopify), que no se copian
// Solo las del bucket se borran del almacenamiento cuando se quitan.

export const BUCKET_IMAGENES = "productos-imagenes";
export const MAX_IMAGENES = 10;

const PREFIJO_PUBLICO = `/storage/v1/object/public/${BUCKET_IMAGENES}/`;

/**
 * Ruta dentro del bucket si la URL es una foto subida a nuestro Supabase;
 * null si es un enlace externo.
 */
export function rutaImagenPropia(url: string, supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const u = new URL(url);
    if (u.origin !== new URL(supabaseUrl).origin) return null;
    if (!u.pathname.startsWith(PREFIJO_PUBLICO)) return null;
    const ruta = decodeURIComponent(u.pathname.slice(PREFIJO_PUBLICO.length));
    return ruta && !ruta.includes("..") ? ruta : null;
  } catch {
    return null;
  }
}

/** {workspace}/{id}.jpg — el primer segmento es el que revisan las políticas del bucket. */
export function rutaNuevaImagen(workspaceId: string, id: string, tipo: string): string {
  return `${workspaceId}/${id}.${tipo === "image/png" ? "png" : "jpg"}`;
}

/**
 * Fotos propias de este workspace que estaban antes y ya no están: son las
 * que se pueden borrar del bucket. Nunca devuelve rutas de otro workspace.
 */
export function rutasParaBorrar(
  antes: string[],
  despues: string[],
  workspaceId: string,
  supabaseUrl: string | undefined,
): string[] {
  const siguen = new Set(despues);
  return antes
    .filter((u) => !siguen.has(u))
    .map((u) => rutaImagenPropia(u, supabaseUrl))
    .filter((r): r is string => r !== null && r.startsWith(`${workspaceId}/`));
}
