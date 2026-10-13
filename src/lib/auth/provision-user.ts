// Alta de usuarios de un workspace por invitación.
//
// Nadie más que la persona conoce su contraseña: para un correo nuevo se crea
// la cuenta SIN contraseña y se le envía (con nuestro proveedor de correo, no
// el SMTP de Supabase) un enlace de un solo uso a /auth/confirmar, donde la
// elige. Un correo que ya tiene cuenta se resuelve sin tocar su contraseña.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarCorreo } from "@/features/email/services/enviar";
import { emailBrand } from "@/features/email/lib/config";

export interface ProvisionResult {
  userId: string;
  /** true cuando la cuenta es nueva (o nunca se activó) y se le mandó el enlace. */
  created: boolean;
  /** Solo con created: si el correo de invitación salió. */
  invitacionEnviada: boolean;
}

/**
 * Invita a `email`: si no tiene cuenta activa, la crea (sin contraseña) y le
 * envía el enlace para elegirla; si ya tiene cuenta, solo devuelve su id.
 * Asegura la fila de `users`.
 *
 * @param service  Cliente con service role (API de administración).
 */
export async function provisionWorkspaceUser(
  service: SupabaseClient,
  rawEmail: string,
  opts: { workspaceId: string; workspaceName: string; fullName?: string },
): Promise<ProvisionResult> {
  const email = rawEmail.trim().toLowerCase();

  // generateLink('invite') crea la cuenta (o reusa una invitada que nunca se
  // activó) sin enviar nada; a una cuenta ya confirmada la rechaza.
  const { data, error } = await service.auth.admin.generateLink({
    type: "invite",
    email,
  });

  let userId = data?.user?.id ?? null;
  const tokenHash = data?.properties?.hashed_token ?? null;
  const created = Boolean(userId && tokenHash);

  if (!created) {
    userId = await usuarioExistente(service, email);
    if (!userId) throw new Error(error?.message ?? "No se pudo crear el usuario");
  }

  await service.from("users").upsert(
    {
      id: userId,
      email,
      full_name: opts.fullName ?? email.split("@")[0],
      is_active: true,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  let invitacionEnviada = false;
  if (created) {
    const url = `${emailBrand().appUrl}/auth/confirmar?token_hash=${encodeURIComponent(tokenHash!)}&type=invite`;
    const enviado = await enviarCorreo({
      template: "invitacion",
      data: { workspaceName: opts.workspaceName, url },
      to: email,
      workspaceId: opts.workspaceId,
    });
    invitacionEnviada = enviado.ok;
  }

  return { userId: userId!, created, invitacionEnviada };
}

async function usuarioExistente(service: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await service.from("users").select("id").eq("email", email).maybeSingle();
  if (data?.id) return data.id as string;
  // Sin fila en users: se recorre auth.users página por página (la API no busca por correo).
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data: list, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = list?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (users.length < perPage) break;
  }
  return null;
}
