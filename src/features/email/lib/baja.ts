// Enlace de baja firmado: deja de enviar correos a un usuario en un workspace
// sin pedirle que inicie sesión. La firma (HMAC) evita que alguien desactive
// los correos de otra persona cambiando los ids de la URL.

import { createHmac, timingSafeEqual } from "node:crypto";

// Una clave corta o que todavía es el texto de ejemplo ("<aleatorio>",
// "your-…") no protege nada: la firma se podría calcular con lo que dice la
// documentación. Se trata como si no estuviera.
const MIN_LARGO_CLAVE = 32;

function claveSegura(valor: string | undefined): string | null {
  const v = valor?.trim();
  if (!v || v.length < MIN_LARGO_CLAVE || /[<>]|your-/.test(v)) return null;
  return v;
}

let avisoClave = false;

function secret(): string | null {
  const propia = claveSegura(process.env.EMAIL_UNSUBSCRIBE_SECRET);
  if (propia) return propia;
  if (process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() && !avisoClave) {
    avisoClave = true;
    console.warn(
      "[email/baja] EMAIL_UNSUBSCRIBE_SECRET es un texto de ejemplo o tiene menos de 32 caracteres; se ignora.",
    );
  }
  // Sin clave propia: una derivada de CRON_SECRET solo para esto, así la misma
  // clave no firma dos cosas distintas.
  const cron = claveSegura(process.env.CRON_SECRET);
  return cron ? createHmac("sha256", cron).update("email-baja").digest("hex") : null;
}

function firma(userId: string, workspaceId: string, key: string): string {
  return createHmac("sha256", key).update(`baja:${userId}:${workspaceId}`).digest("base64url");
}

/** null si no hay secreto configurado (el correo sale sin enlace de baja). */
export function tokenBaja(userId: string, workspaceId: string): string | null {
  const key = secret();
  return key ? firma(userId, workspaceId, key) : null;
}

export function verificarBaja(userId: string, workspaceId: string, token: string): boolean {
  const key = secret();
  if (!key || !token) return false;
  const esperado = Buffer.from(firma(userId, workspaceId, key));
  const dado = Buffer.from(token);
  return esperado.length === dado.length && timingSafeEqual(esperado, dado);
}

export function urlBaja(appUrl: string, userId: string, workspaceId: string): string | null {
  const t = tokenBaja(userId, workspaceId);
  if (!t) return null;
  const q = new URLSearchParams({ u: userId, w: workspaceId, t });
  return `${appUrl}/api/email/baja?${q.toString()}`;
}
