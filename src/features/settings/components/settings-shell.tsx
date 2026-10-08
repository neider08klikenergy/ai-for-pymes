"use client";

import { toast } from "sonner";
import { KbTab } from "./kb-tab";
import { useEffect } from "react";
import { TeamTab } from "./team-tab";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ToolsCatalog } from "./tools-catalog";
import { TemplatesTab } from "./templates-tab";
import { AutomationsTab } from "./automations-tab";
import { IntegrationsTab } from "./integrations-tab";
import { BusinessInfoForm } from "./business-info-form";
import type { AgentDto } from "@/features/agents/types";
import { AgentsTab } from "@/features/agents/components/agents-tab";
import type { AjustesPedidos } from "@/features/pedidos/lib/ajustes";
import type { JevSettings } from "@/features/jev-judge/components/jev-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AjustesPedidosPanel } from "@/features/pedidos/components/ajustes-pedidos";
import { PreferenciasCorreo } from "@/features/email/components/preferencias-correo";

interface ToolItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sensitivity: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

interface Props {
  workspaceId: string;
  role: string;
  initialBusinessInfo: Record<string, unknown> | null;
  initialTools: ToolItem[];
  initialIntegrations: unknown[];
  initialTemplates?: unknown[];
  initialAgents?: AgentDto[];
  jev: JevSettings;
  /** Cuentas de pago, domicilios y sedes; null si el workspace no usa pedidos. */
  ajustesPedidos?: AjustesPedidos | null;
  /** Pestaña inicial (?tab=…). */
  initialTab?: string;
  /** Resultado de conectar un canal en Zernio, para avisarlo una vez. */
  avisoZernio?: { ok: boolean; canal: string; detalle: string } | null;
}

const CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

export function SettingsShell({
  workspaceId,
  role,
  initialBusinessInfo,
  initialTools,
  initialIntegrations,
  initialTemplates = [],
  initialAgents = [],
  jev,
  ajustesPedidos = null,
  initialTab = "agentes",
  avisoZernio = null,
}: Props) {
  const tr = useTranslations("ui.settingsShell");
  const router = useRouter();
  useEffect(() => {
    if (!avisoZernio) return;
    const canal = CANAL[avisoZernio.canal] ?? "El canal";
    const t = setTimeout(() => {
      if (avisoZernio.ok) {
        toast.success(`${canal} quedó conectado en Zernio`, {
          description:
            "Si Zernio aún no es el proveedor activo, guarda con «Guardar y cambiar a Zernio».",
        });
      } else {
        toast.error(
          `No se pudo conectar ${canal === "El canal" ? "el canal" : canal}`,
          {
            description: avisoZernio.detalle || undefined,
          },
        );
      }
      // Limpia la URL para que el aviso no se repita al recargar.
      router.replace("/settings?tab=integraciones");
    }, 0);
    return () => clearTimeout(t);
  }, [avisoZernio, router]);

  const biForForm = initialBusinessInfo as {
    structured: Record<string, unknown>;
    free_text: string | null;
  } | null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-xl font-semibold text-foreground mb-6">
        {tr("configuracionDelWorkspace")}
      </h1>

      <Tabs defaultValue={initialTab}>
        {/* Scroll the tab strip within its own track instead of letting 11 tabs
            push horizontal overflow onto the whole page. */}
        <div className="mb-6 -mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="agentes">{tr("agentes")}</TabsTrigger>
            <TabsTrigger value="integraciones">
              {tr("integraciones")}
            </TabsTrigger>
            <TabsTrigger value="negocio">{tr("negocio")}</TabsTrigger>
            <TabsTrigger value="tools">{tr("tools")}</TabsTrigger>
            <TabsTrigger value="templates">{tr("templates")}</TabsTrigger>
            <TabsTrigger value="knowledge-base">
              {tr("knowledgeBase")}
            </TabsTrigger>
            <TabsTrigger value="equipo">{tr("equipo")}</TabsTrigger>
            <TabsTrigger value="automatizaciones">
              {tr("automatizaciones")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="agentes">
          <div className="p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <AgentsTab
              workspaceId={workspaceId}
              initialAgents={initialAgents}
              jev={jev}
              canManage={role === "admin" || role === "manager"}
            />
          </div>
        </TabsContent>

        <TabsContent value="integraciones">
          <div className="p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <IntegrationsTab
              workspaceId={workspaceId}
              role={role}
              initialIntegrations={initialIntegrations}
            />
          </div>
        </TabsContent>

        <TabsContent value="negocio">
          <div className="p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <BusinessInfoForm workspaceId={workspaceId} initial={biForForm} />
          </div>
          {ajustesPedidos && (
            <div className="mt-6 p-6 rounded-lg border border-border/60 bg-card">
              <AjustesPedidosPanel
                workspaceId={workspaceId}
                ajustes={ajustesPedidos}
                puedeEditar={role === "admin" || role === "manager"}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="tools">
          <div className="p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <ToolsCatalog
              workspaceId={workspaceId}
              role={role}
              initialTools={initialTools}
            />
          </div>
        </TabsContent>

        <TabsContent value="templates">
          <div className="p-6 rounded-lg border border-border/60 bg-card">
            <TemplatesTab
              workspaceId={workspaceId}
              initialTemplates={initialTemplates}
            />
          </div>
        </TabsContent>
        <TabsContent value="knowledge-base">
          <div className="p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <KbTab workspaceId={workspaceId} />
          </div>
        </TabsContent>

        <TabsContent value="equipo">
          <div className="p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <PreferenciasCorreo workspaceId={workspaceId} />
            <TeamTab workspaceId={workspaceId} />
          </div>
        </TabsContent>

        <TabsContent value="automatizaciones">
          <div className="p-6 space-y-6 rounded-lg border border-border/60 bg-card">
            <AutomationsTab workspaceId={workspaceId} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
