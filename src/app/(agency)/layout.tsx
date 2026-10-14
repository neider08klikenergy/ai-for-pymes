import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/branding";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { MenuUsuario } from "@/components/menu-usuario";
import { NavPrincipal } from "@/components/nav-principal";

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common.nav");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("is_super_admin, full_name")
    .eq("id", user.id)
    .single();

  if (!userRow?.is_super_admin) redirect("/inbox");

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className={cn(
          "glass-strong sticky top-0 z-50 h-14 shrink-0",
          "flex items-center justify-between gap-3 px-3 sm:px-6",
          "border-b border-border/50",
        )}
      >
        {/* Izquierda: marca + "Agencia" y sus secciones */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="font-display text-base font-semibold text-primary tracking-tight">
              {APP_NAME}
            </span>
            <Badge
              variant="outline"
              className="border-primary/30 bg-primary/10 text-primary text-xs font-mono px-1.5 py-0"
            >
              {t("agencia")}
            </Badge>
          </div>
          <NavPrincipal
            grupo="agencia"
            variante="header"
            ariaLabel={t("navegacionAgencia")}
            etiquetas={{
              workspaces: t("workspaces"),
              solicitudes: t("solicitudes"),
              pqrs: t("pqrs"),
            }}
          />
        </div>

        {/* Derecha: la cuenta (volver al panel, idioma, tema, salir) */}
        <MenuUsuario
          contexto="agencia"
          nombre={(userRow.full_name as string | null | undefined) ?? null}
          email={user.email ?? ""}
          esSuperAdmin
          etiquetas={{
            cuenta: t("miCuenta"),
            miCuenta: t("miCuenta"),
            settings: t("settings"),
            agencia: t("agencia"),
            volverAlPanel: t("volverAlPanel"),
            idioma: t("idioma"),
            temaClaro: t("temaClaro"),
            temaOscuro: t("temaOscuro"),
            salir: t("salir"),
          }}
        />
      </header>

      <main className="flex-1 px-3 sm:px-6 py-6">{children}</main>
    </div>
  );
}
