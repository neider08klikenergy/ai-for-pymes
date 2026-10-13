import {
  listMemberships,
  getActiveWorkspace,
} from "@/features/workspace/services/active-workspace";
import {
  InvitacionesPendientes,
  type InvitacionPendiente,
} from "@/features/workspace/components/invitaciones-pendientes";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/branding";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { resolveTimeZone } from "@/shared/lib/timezone";
import { MenuUsuario } from "@/components/menu-usuario";
import { NavPrincipal } from "@/components/nav-principal";
import { BotonPqrs } from "@/features/pqrs/components/boton-pqrs";
import { ZonaHorariaProvider } from "@/shared/lib/zona-horaria-context";
import { WorkspaceSwitcher } from "@/features/workspace/components/workspace-switcher";
import { CampanaNotificaciones } from "@/features/notificaciones/components/campana-notificaciones";

export default async function MainLayout({
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

  // Super admin flag + active workspace context + membership list (for switcher)
  const [
    { data: userRow },
    active,
    memberships,
    { data: invitaciones },
    { data: perfil },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("is_super_admin, full_name")
      .eq("id", user.id)
      .maybeSingle(),
    getActiveWorkspace(supabase, user.id),
    listMemberships(supabase, user.id),
    // Invitaciones al equipo que esta persona todavía no respondió.
    supabase.rpc("mis_invitaciones"),
    // Contacto de soporte de Felrick (Agencia → Perfil) para el botón Soporte.
    supabase
      .from("perfil_plataforma")
      .select("soporte_email, soporte_whatsapp")
      .maybeSingle(),
  ]);

  const isSuperAdmin = userRow?.is_super_admin ?? false;

  // Zona horaria del negocio (Settings → Negocio) para mostrar horas locales.
  const { data: biRow } = active
    ? await supabase
        .from("business_info")
        .select("structured")
        .eq("workspace_id", active.workspace_id)
        .maybeSingle()
    : { data: null };
  const zonaHoraria = resolveTimeZone(
    (biRow?.structured as { timezone?: string } | null)?.timezone,
  );
  const activeId = active?.workspace_id ?? null;
  const workspaceName =
    memberships.find((m) => m.workspace_id === activeId)?.name ?? null;
  const etiquetasNav = {
    inbox: t("inbox"),
    pedidos: t("pedidos"),
    productos: t("productos"),
    dashboard: t("dashboard"),
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className={cn(
          "glass-strong sticky top-0 z-50 h-14 shrink-0",
          "flex items-center justify-between px-3 sm:px-6",
          "border-b border-border/50",
        )}
      >
        {/* Izquierda: marca y workspace, luego las secciones del día a día */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-display text-base font-semibold text-primary tracking-tight shrink-0">
              {APP_NAME}
            </span>
            {workspaceName && (
              <>
                <span
                  className="text-border/70 select-none shrink-0"
                  aria-hidden="true"
                >
                  /
                </span>
                {memberships.length > 1 && activeId ? (
                  <WorkspaceSwitcher
                    workspaces={memberships.map((m) => ({
                      workspace_id: m.workspace_id,
                      name: m.name,
                    }))}
                    activeId={activeId}
                  />
                ) : (
                  <span
                    className="font-mono text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[200px]"
                    title={workspaceName}
                  >
                    {workspaceName}
                  </span>
                )}
              </>
            )}
          </div>

          <NavPrincipal
            variante="header"
            etiquetas={etiquetasNav}
            ariaLabel={t("navegacionPrincipal")}
          />
        </div>

        {/* Derecha: ayuda, avisos y la cuenta */}
        <div className="flex items-center gap-1 shrink-0">
          {activeId && (
            <BotonPqrs
              workspaceId={activeId}
              contacto={{
                email: perfil?.soporte_email ?? null,
                whatsapp: perfil?.soporte_whatsapp ?? [],
              }}
            />
          )}
          {activeId && <CampanaNotificaciones />}
          <MenuUsuario
            nombre={(userRow?.full_name as string | null | undefined) ?? null}
            email={user.email ?? ""}
            esSuperAdmin={isSuperAdmin}
            etiquetas={{
              cuenta: t("miCuenta"),
              settings: t("settings"),
              agencia: t("agencia"),
              idioma: t("idioma"),
              temaClaro: t("temaClaro"),
              temaOscuro: t("temaOscuro"),
              salir: t("salir"),
            }}
          />
        </div>
      </header>

      <InvitacionesPendientes
        invitaciones={(invitaciones ?? []) as InvitacionPendiente[]}
      />

      <div className="flex-1 pb-14 md:pb-0">
        <ZonaHorariaProvider zona={zonaHoraria}>{children}</ZonaHorariaProvider>
      </div>

      {/* Móvil: las secciones en la barra inferior; lo demás, en el menú de cuenta */}
      <NavPrincipal
        variante="movil"
        etiquetas={etiquetasNav}
        ariaLabel={t("navegacionMovil")}
      />
    </div>
  );
}
