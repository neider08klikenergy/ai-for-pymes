"use server";

// Agencia → PQRS: el equipo de Felrick cambia el estado. RLS exige super
// admin; aquí se revisa antes para dar un mensaje claro.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ESTADOS_PQRS } from "../lib/pqrs";
import { createClient } from "@/lib/supabase/server";

export type ResultadoPqrs = { ok: true } | { ok: false; error: string };

const CambioSchema = z.object({
  id: z.string().uuid(),
  estado: z.enum(ESTADOS_PQRS),
});

export async function actualizarEstadoPqrs(
  input: unknown,
): Promise<ResultadoPqrs> {
  const parsed = CambioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Estado no válido" };

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
      error: "Solo el equipo de Felrick puede gestionar PQRS",
    };

  const { data, error } = await supabase
    .from("pqrs")
    .update({ estado: parsed.data.estado })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) {
    console.error("[pqrs] actualizarEstadoPqrs:", error.message);
    return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  }
  if (!data?.length) return { ok: false, error: "Esa PQRS ya no existe" };
  revalidatePath("/pqrs");
  return { ok: true };
}
