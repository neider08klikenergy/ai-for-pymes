import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PerfilForm } from "@/features/plataforma/components/perfil-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Perfil de la startup",
};

export default async function PerfilPage() {
  // El layout de agencia ya exige super admin; RLS exige lo mismo al guardar.
  const supabase = await createClient();
  const { data } = await supabase
    .from("perfil_plataforma")
    .select("soporte_email, soporte_whatsapp")
    .maybeSingle();

  return (
    <PerfilForm
      inicial={{ email: data?.soporte_email ?? null, whatsapp: data?.soporte_whatsapp ?? [] }}
    />
  );
}
