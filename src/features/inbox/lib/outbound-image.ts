// Reglas para las imágenes que el equipo envía desde el inbox. Las comparten
// el composer (para avisar antes de subir) y la ruta del servidor (que es la
// que decide). WhatsApp acepta JPEG y PNG hasta 5 MB, pero una función de
// Vercel no recibe cuerpos de más de 4,5 MB: el tope es 4 MB y el composer
// reduce antes las fotos más pesadas.

export const OUTBOUND_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export type OutboundImageType = (typeof OUTBOUND_IMAGE_TYPES)[number];

export const OUTBOUND_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Lo que va en el atributo `accept` del input de archivo. */
export const OUTBOUND_IMAGE_ACCEPT = OUTBOUND_IMAGE_TYPES.join(",");

/** Pie de foto: WhatsApp corta en 1.024 caracteres. */
export const OUTBOUND_CAPTION_MAX = 1024;

export function isOutboundImageType(type: string): type is OutboundImageType {
  return (OUTBOUND_IMAGE_TYPES as readonly string[]).includes(type);
}

/** null si la imagen se puede enviar; si no, el motivo en español. */
export function validateOutboundImage(file: { type: string; size: number }): string | null {
  if (!isOutboundImageType(file.type)) {
    return "Solo se pueden enviar imágenes JPG o PNG";
  }
  if (file.size <= 0) return "La imagen está vacía";
  if (file.size > OUTBOUND_IMAGE_MAX_BYTES) {
    return "La imagen pesa más de 4 MB";
  }
  return null;
}

/** <workspace>/<conversación>/<archivo>: la forma que acepta /api/inbox/media-url. */
export function outboundImagePath(
  workspaceId: string,
  conversationId: string,
  type: OutboundImageType,
  id: string,
): string {
  const ext = type === "image/png" ? "png" : "jpg";
  return `${workspaceId}/${conversationId}/out-${id}.${ext}`;
}
