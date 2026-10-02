// Solo navegador. Deja una foto lista para enviar: si pesa más del tope o es
// muy grande (o viene en un formato que WhatsApp no acepta, como WebP o HEIC
// que el navegador sepa leer), la redibuja como JPEG más liviano.

import {
  OUTBOUND_IMAGE_MAX_BYTES,
  isOutboundImageType,
} from "./outbound-image";

const MAX_SIDE = 2048;
const QUALITIES = [0.85, 0.75, 0.6];

async function loadBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Devuelve el archivo a enviar, o un mensaje de error en español.
 * Una foto que ya cumple (JPG/PNG, ≤ tope) sale tal cual.
 */
export async function prepareImage(file: File): Promise<File | { error: string }> {
  if (!file.type.startsWith("image/")) {
    return { error: "Solo se pueden enviar imágenes" };
  }
  if (isOutboundImageType(file.type) && file.size <= OUTBOUND_IMAGE_MAX_BYTES) {
    return file;
  }

  const bitmap = await loadBitmap(file);
  if (!bitmap) return { error: "No se pudo leer la imagen. Prueba con un JPG o PNG." };

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { error: "No se pudo procesar la imagen" };
  // Fondo blanco: un PNG con transparencia no queda negro al pasar a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const q of QUALITIES) {
    const blob = await toJpeg(canvas, q);
    if (blob && blob.size <= OUTBOUND_IMAGE_MAX_BYTES) {
      const name = file.name.replace(/\.[^.]+$/, "") || "imagen";
      return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
    }
  }
  return { error: "La imagen es demasiado pesada, incluso reducida" };
}
