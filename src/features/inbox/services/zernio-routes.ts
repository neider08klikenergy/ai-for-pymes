// Piezas compartidas por las rutas de conexión de Zernio.

import { createClient as createSbClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ZernioConfigError, ZernioError } from "./zernio-client";

export function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Origen público de la app (para las URLs de regreso de Zernio). */
export function appOrigin(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return configured || req.nextUrl.origin;
}

/** Mensaje en español para el equipo; el detalle de Zernio va al log. */
export function zernioErrorMessage(err: unknown): string {
  if (err instanceof ZernioConfigError) return err.message;
  if (err instanceof ZernioError) {
    if (err.status === 401) return "La API key de Zernio no es válida (ZERNIO_API_KEY)";
    if (err.status === 402) return "Zernio pide actualizar el plan para conectar más cuentas";
    if (err.status === 429) return "Zernio está limitando las peticiones; intenta en un minuto";
    return "Zernio no respondió como se esperaba; intenta de nuevo";
  }
  return "No se pudo conectar con Zernio";
}

export const PLATFORM_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};
