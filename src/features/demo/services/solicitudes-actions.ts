"use server";

// Solicitudes de demo. Crear es público (página /demo, sin sesión): valida,
// descarta bots (campo trampa) y limita por correo; inserta con el service
// role porque anon no tiene permisos en la tabla. Gestionarlas es solo del
// equipo de Felrick (super admin): RLS lo exige y aquí se revisa antes para
// dar un mensaje claro.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClient as svcClient } from "@supabase/supabase-js";
import { ESTADOS, SolicitudSchema, primerError } from "../lib/solicitud";

export type ResultadoSolicitud = { ok: true } | { ok: false; error: string };

/** Solicitudes por correo en 24 h antes de dejar de aceptar (evita spam). */
const MAX_POR_CORREO_DIA = 3;

function svc() {
  return svcClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function crearSolicitudDemo(input: unknown): Promise<ResultadoSolicitud> {
  const parsed = SolicitudSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  const { sitio_web, ...datos } = parsed.data;

  // Un bot llenó el campo oculto: se responde "ok" sin guardar nada
  if (sitio_web?.trim()) return { ok: true };

  const db = svc();
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db
    .from("solicitudes_demo")
    .select("id", { count: "exact", head: true })
    // El esquema ya guarda el correo en minúsculas
    .eq("correo", datos.correo)
    .gte("created_at", desde);
  if ((count ?? 0) >= MAX_POR_CORREO_DIA) {
    // Ya la tenemos: no se guarda otra, pero la persona puede seguir y agendar
    return { ok: true };
  }

  const { error } = await db.from("solicitudes_demo").insert(datos);
  if (error) {
    console.error("[demo] crearSolicitudDemo:", error.message);
    // Clave de demo.errores: la traduce la página
    return { ok: false, error: "guardar" };
  }
  return { ok: true };
}

// ── Gestión (equipo de Felrick) ──────────────────────────────────────────────

const CambioSchema = z.object({
  id: z.string().uuid(),
  estado: z.enum(ESTADOS),
  notas: z
    .string()
    .trim()
    .max(4000)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  demo_at: z
    .union([z.literal(""), z.null(), z.string().datetime({ offset: true })])
    .optional()
    .transform((v) => (v ? v : null)),
});

async function esSuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("users").select("is_super_admin").eq("id", user.id).single();
  return Boolean(data?.is_super_admin);
}

export async function actualizarSolicitud(input: unknown): Promise<ResultadoSolicitud> {
  if (!(await esSuperAdmin())) return { ok: false, error: "Solo el equipo de Felrick puede gestionar solicitudes" };
  const parsed = CambioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const { id, ...cambios } = parsed.data;
  // Cliente del usuario: la política de RLS vuelve a exigir super admin
  const supabase = await createClient();
  const { data, error } = await supabase.from("solicitudes_demo").update(cambios).eq("id", id).select("id");
  if (error) {
    console.error("[demo] actualizarSolicitud:", error.message);
    return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  }
  if (!data?.length) return { ok: false, error: "Esa solicitud ya no existe" };
  revalidatePath("/solicitudes");
  return { ok: true };
}
