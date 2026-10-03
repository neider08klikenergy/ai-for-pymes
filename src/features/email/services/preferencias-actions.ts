"use server";

// Preferencias de correo de la persona que está en el panel (Settings → Equipo).
// Lee y guarda con el cliente del usuario: RLS solo deja tocar las propias.

import { z } from "zod";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMember } from "@/lib/auth/workspace-access";
import { emailSender } from "../lib/config";
import { TIPOS_CORREO, TIPOS_CORREO_POR_DEFECTO, isTipoCorreo, type TipoCorreo } from "../lib/tipos";
import { enviarCorreo } from "./enviar";

export interface PreferenciasCorreoVista {
  activo: boolean;
  tipos: TipoCorreo[];
  email: string | null;
  /** False si la plataforma aún no tiene remitente configurado. */
  configurado: boolean;
}

type Resultado = { ok: true } | { ok: false; error: string };

const Uuid = z.string().uuid();

const GuardarSchema = z.object({
  activo: z.boolean(),
  tipos: z.array(z.enum(TIPOS_CORREO)).max(TIPOS_CORREO.length),
});

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function leerPreferenciasCorreo(
  workspaceId: string,
): Promise<PreferenciasCorreoVista | null> {
  if (!Uuid.safeParse(workspaceId).success) return null;
  const acceso = await checkWorkspaceMember(workspaceId);
  if (!acceso.ok) return null;

  const supabase = await createClient();
  const [prefRes, userRes] = await Promise.all([
    supabase
      .from("preferencias_correo")
      .select("activo, tipos")
      .eq("workspace_id", workspaceId)
      .eq("user_id", acceso.userId)
      .maybeSingle(),
    supabase.from("users").select("email").eq("id", acceso.userId).maybeSingle(),
  ]);

  const tipos = Array.isArray(prefRes.data?.tipos)
    ? (prefRes.data.tipos as unknown[]).filter(isTipoCorreo)
    : TIPOS_CORREO_POR_DEFECTO;
  return {
    activo: prefRes.data?.activo === true,
    tipos,
    email: (userRes.data?.email as string | undefined) ?? null,
    configurado: emailSender() !== null,
  };
}

export async function guardarPreferenciasCorreo(
  workspaceId: string,
  input: unknown,
): Promise<Resultado> {
  if (!Uuid.safeParse(workspaceId).success) return { ok: false, error: "Workspace no válido" };
  const acceso = await checkWorkspaceMember(workspaceId);
  if (!acceso.ok) return { ok: false, error: "No tienes acceso a este workspace" };
  const parsed = GuardarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos" };

  const supabase = await createClient();
  const { error } = await supabase.from("preferencias_correo").upsert(
    {
      user_id: acceso.userId,
      workspace_id: workspaceId,
      activo: parsed.data.activo,
      tipos: [...new Set(parsed.data.tipos)],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,workspace_id" },
  );
  if (error) {
    console.error("[email] guardar preferencias:", error.message);
    return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  }
  return { ok: true };
}

/** Un correo de prueba a uno mismo, como mucho uno por minuto. */
export async function enviarCorreoPrueba(workspaceId: string): Promise<Resultado> {
  if (!Uuid.safeParse(workspaceId).success) return { ok: false, error: "Workspace no válido" };
  const acceso = await checkWorkspaceMember(workspaceId);
  if (!acceso.ok) return { ok: false, error: "No tienes acceso a este workspace" };
  if (!emailSender()) return { ok: false, error: "Los correos aún no están configurados en la plataforma" };

  const db = svc();
  const haceUnMinuto = new Date(Date.now() - 60_000).toISOString();
  const [userRes, wsRes, prefRes, recienteRes] = await Promise.all([
    db.from("users").select("email, full_name").eq("id", acceso.userId).maybeSingle(),
    db.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    db
      .from("preferencias_correo")
      .select("tipos")
      .eq("user_id", acceso.userId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    db
      .from("correos_enviados")
      .select("id")
      .eq("user_id", acceso.userId)
      .eq("plantilla", "prueba")
      .gte("created_at", haceUnMinuto)
      .limit(1),
  ]);
  if ((recienteRes.data ?? []).length > 0) {
    return { ok: false, error: "Ya enviaste uno hace un momento. Espera un minuto." };
  }
  const email = userRes.data?.email as string | undefined;
  if (!email) return { ok: false, error: "Tu usuario no tiene correo" };

  const tipos = Array.isArray(prefRes.data?.tipos)
    ? (prefRes.data.tipos as unknown[]).filter(isTipoCorreo)
    : TIPOS_CORREO_POR_DEFECTO;
  const nombre = ((userRes.data?.full_name as string | undefined) ?? "").trim().split(/\s+/)[0] || null;

  const r = await enviarCorreo({
    template: "prueba",
    data: { nombre, workspaceName: (wsRes.data?.name as string | undefined) ?? "Tu negocio", tipos },
    to: email,
    toName: nombre,
    workspaceId,
    userId: acceso.userId,
  });
  return r.ok ? { ok: true } : { ok: false, error: "No se pudo enviar el correo. Revisa la configuración del proveedor." };
}
