"use server";

// Agencia → Perfil: el equipo de Felrick guarda el contacto de soporte. RLS
// exige super admin; aquí se revisa antes para dar un mensaje claro.

import { revalidatePath } from "next/cache";
import { PerfilSchema } from "../lib/perfil";
import { createClient } from "@/lib/supabase/server";

export type ResultadoPerfil = { ok: true } | { ok: false; error: string };

export async function guardarPerfilPlataforma(
  input: unknown,
): Promise<ResultadoPerfil> {
  const parsed = PerfilSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos no válidos",
    };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión de nuevo" };
  const { data: fila } = await supabase
    .from("users")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();
  if (!fila?.is_super_admin)
    return {
      ok: false,
      error: "Solo el equipo de Felrick puede editar el perfil",
    };

  const { data, error } = await supabase
    .from("perfil_plataforma")
    .update({
      soporte_email: parsed.data.email,
      soporte_whatsapp: parsed.data.whatsapp,
    })
    .eq("id", true)
    .select("id");
  if (error || !data?.length) {
    console.error(
      "[perfil] guardarPerfilPlataforma:",
      error?.message ?? "sin fila",
    );
    return {
      ok: false,
      error:
        "No se pudo guardar. Revisa que la migración del perfil esté aplicada.",
    };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
