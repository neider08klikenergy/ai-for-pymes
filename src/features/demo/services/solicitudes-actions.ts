"use server";

// Solicitudes de demo. Crear es público (página /demo, sin sesión): valida,
// descarta bots (campo trampa) y limita por correo, por conexión (IP, guardada
// solo como hash) y en total por hora; inserta con el service
// role porque anon no tiene permisos en la tabla. Gestionarlas es solo del
// equipo de Felrick (super admin): RLS lo exige y aquí se revisa antes para
// dar un mensaje claro.

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { hashIp, ipDe } from "../lib/origen";
import { createClient } from "@/lib/supabase/server";
import { createClient as svcClient } from "@supabase/supabase-js";
import { ESTADOS, SolicitudSchema, primerError } from "../lib/solicitud";

export type ResultadoSolicitud = { ok: true } | { ok: false; error: string };

/** Solicitudes por correo en 24 h antes de dejar de aceptar (evita spam). */
const MAX_POR_CORREO_DIA = 3;
/** Por conexión: cambiar el correo no basta para seguir insertando. */
const MAX_POR_IP_HORA = 5;
const MAX_POR_IP_DIA = 10;
/** En total: frena un ataque que rote de IP sin llenar la tabla. */
const MAX_TOTAL_HORA = 60;

const HORA = 3600 * 1000;

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
  const ipHash = hashIp(ipDe(await headers()));
  const haceUnaHora = new Date(Date.now() - HORA).toISOString();
  const haceUnDia = new Date(Date.now() - 24 * HORA).toISOString();
  const contar = () =>
    db.from("solicitudes_demo").select("id", { count: "exact", head: true });

  const [porCorreo, porIpHora, porIpDia, total] = await Promise.all([
    // El esquema ya guarda el correo en minúsculas
    contar().eq("correo", datos.correo).gte("created_at", haceUnDia),
    contar().eq("ip_hash", ipHash).gte("created_at", haceUnaHora),
    contar().eq("ip_hash", ipHash).gte("created_at", haceUnDia),
    contar().gte("created_at", haceUnaHora),
  ]);
  // Si un conteo falla no se frena a nadie: el límite es contra spam, y
  // perder una solicitud real cuesta más que guardar una de más.
  const supera = (r: { count: number | null }, max: number) => (r.count ?? 0) >= max;
  if (
    supera(porCorreo, MAX_POR_CORREO_DIA) ||
    supera(porIpHora, MAX_POR_IP_HORA) ||
    supera(porIpDia, MAX_POR_IP_DIA) ||
    supera(total, MAX_TOTAL_HORA)
  ) {
    if (supera(total, MAX_TOTAL_HORA)) {
      console.warn("[demo] tope de solicitudes por hora alcanzado; no se guardan más");
    }
    // No se guarda otra, pero la persona puede seguir y agendar (y un bot no
    // sabe que lo frenamos).
    return { ok: true };
  }

  const { error } = await db.from("solicitudes_demo").insert({ ...datos, ip_hash: ipHash });
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
