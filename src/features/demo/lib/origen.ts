// Origen de una solicitud de demo, para limitar por conexión sin guardar la IP.

import { createHash, createHmac } from "node:crypto";

/**
 * IP del cliente según el proxy de la plataforma. En Vercel, x-real-ip y el
 * primer valor de x-forwarded-for los pone Vercel (no el navegador). Sin
 * ninguno, todas las solicitudes comparten el mismo grupo "desconocida".
 */
export function ipDe(headers: Pick<Headers, "get">): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "desconocida";
}

/**
 * HMAC de la IP con una clave del servidor (derivada de CRON_SECRET, como la
 * de los enlaces de baja): sirve para contar solicitudes por conexión, pero
 * no permite recuperar la IP probando todas las direcciones posibles.
 */
export function hashIp(ip: string, secreto = process.env.CRON_SECRET?.trim()): string {
  if (!secreto) return createHash("sha256").update(`demo-ip:${ip}`).digest("hex");
  const clave = createHmac("sha256", secreto).update("demo-ip").digest();
  return createHmac("sha256", clave).update(ip).digest("hex");
}
