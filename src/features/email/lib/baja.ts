// Enlace de baja firmado: deja de enviar correos a un usuario en un workspace
// sin pedirle que inicie sesión. La firma (HMAC) evita que alguien desactive
// los correos de otra persona cambiando los ids de la URL.

import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || process.env.CRON_SECRET?.trim() || null;
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
