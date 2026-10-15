import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CambiarContrasena } from "@/features/auth/components/cambiar-contrasena";
import { PerfilForm } from "@/features/plataforma/components/perfil-form";

export const metadata: Metadata = {
  title: "Mi cuenta",
};

// Datos personales de quien inició sesión (no de un workspace).
export default async function CuentaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("users")
    .select("full_name, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  // Configuración de Falvrick: solo el super admin la ve (RLS exige lo mismo al guardar).
  const { data: plataforma } = perfil?.is_super_admin
    ? await supabase
        .from("perfil_plataforma")
        .select("soporte_email, soporte_whatsapp")
        .maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
      <div>
        <h1 className="font-display text-xl font-semibold">Mi cuenta</h1>
        <p className="text-sm text-muted-foreground">
          Tus datos de acceso. Valen para todos los workspaces donde estés.
        </p>
      </div>

      <section className="rounded-xl border border-border/60 bg-card p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">Nombre</dt>
          <dd>{perfil?.full_name ?? "—"}</dd>
          <dt className="text-muted-foreground">Correo</dt>
          <dd className="break-all">{user.email}</dd>
        </dl>
      </section>

      <CambiarContrasena />

      {perfil?.is_super_admin && (
        <PerfilForm
          inicial={{
            email: plataforma?.soporte_email ?? null,
            whatsapp: plataforma?.soporte_whatsapp ?? [],
          }}
        />
      )}
    </div>
  );
}
