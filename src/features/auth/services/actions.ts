"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";

// Los mensajes de validación son claves de messages/<idioma>.json
// (auth.errores.*); errorDe() los traduce al idioma del usuario.
type ClaveError =
  | "emailInvalido"
  | "contrasenaCorta"
  | "credenciales"
  | "emailNoConfirmado";

// Errores de Supabase Auth (en inglés) → clave de traducción. Un error que no
// está aquí se muestra tal cual.
const ERRORES_SUPABASE: Record<string, ClaveError> = {
  "Invalid login credentials": "credenciales",
  "Email not confirmed": "emailNoConfirmado",
};

async function errorDe(claveOMensaje: string): Promise<string> {
  const t = await getTranslations("auth.errores");
  return t.has(claveOMensaje) ? t(claveOMensaje as ClaveError) : claveOMensaje;
}

async function localizeAuthError(msg: string): Promise<string> {
  return errorDe(ERRORES_SUPABASE[msg] ?? msg);
}

const loginSchema = z.object({
  email: z.string().email("emailInvalido"),
  password: z.string().min(6, "contrasenaCorta"),
});

export async function login(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: await errorDe(parsed.error.issues[0].message) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: await localizeAuthError(error.message) };
  }

  redirect("/inbox");
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const emailSchema = z.object({
  email: z.string().email("emailInvalido"),
});

export async function requestPasswordReset(
  _prevState: { error?: string; message?: string } | null,
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: await errorDe(parsed.error.issues[0].message) };
  }

  const supabase = await createClient();
  // The link in the email points at the configured app URL, not at whatever
  // Origin the request carries (a caller controls that header). Origin is only
  // a fallback for a local install without NEXT_PUBLIC_APP_URL.
  const origin = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (await headers()).get("origin") ||
    ""
  ).replace(/\/$/, "");

  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo: `${origin}/reset-password` },
  );

  if (error) {
    return { error: await localizeAuthError(error.message) };
  }

  // Neutral message — never reveal whether the email exists.
  const t = await getTranslations("auth.forgot");
  return { message: t("enviado") };
}

const passwordSchema = z.object({
  password: z.string().min(6, "contrasenaCorta"),
});

export async function updatePassword(
  _prevState: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: await errorDe(parsed.error.issues[0].message) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { error: await localizeAuthError(error.message) };
  }

  redirect("/login?message=contrasenaActualizada");
}
