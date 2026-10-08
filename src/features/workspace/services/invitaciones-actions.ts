"use server";

// Respuesta a una invitación al equipo (cuentas que ya existían: el manager
// invita y la persona decide si entra). responder_invitacion() comprueba que
// la invitación sea de quien llama, esté pendiente y no haya vencido.

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "./active-workspace";

const Respuesta = z.object({
  invitacionId: z.string().uuid(),
  aceptar: z.boolean(),
});

export async function responderInvitacion(input: {
  invitacionId: string;
  aceptar: boolean;
}): Promise<{ ok: true; mensaje: string } | { ok: false; error: string }> {
  const t = await getTranslations("common.invitaciones");
  const parsed = Respuesta.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errores.generico") };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("responder_invitacion", {
    p_id: parsed.data.invitacionId,
    p_aceptar: parsed.data.aceptar,
  });
  if (error) {
    console.error("[invitaciones] responder:", error.message);
    return { ok: false, error: t("errores.generico") };
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; workspace_id?: string };
  if (!r.ok) {
    const codigo = `errores.${r.error}`;
    return {
      ok: false,
      error: r.error && t.has(codigo) ? t(codigo as "errores.generico") : t("errores.generico"),
    };
  }

  // Al aceptar, el panel abre el workspace al que acaba de entrar.
  if (parsed.data.aceptar && r.workspace_id) {
    (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, r.workspace_id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, mensaje: parsed.data.aceptar ? t("aceptada") : t("rechazada") };
}
