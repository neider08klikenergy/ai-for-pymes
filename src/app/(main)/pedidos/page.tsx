import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hoyEnZona } from "@/features/pedidos/lib/fechas";
import { PedidosBoard } from "@/features/pedidos/components/pedidos-board";
import { cargarVistaPedidos } from "@/features/pedidos/services/pedidos-queries";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";

export const dynamic = "force-dynamic";

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string; sede?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getActiveWorkspace(supabase, user.id);
  if (!membership) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-sm">
          No tienes un workspace activo.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const vista = await cargarVistaPedidos(supabase, membership.workspace_id, {
    fecha: params.fecha,
    sede: params.sede,
  });

  return (
    <PedidosBoard
      vista={vista}
      hoy={hoyEnZona(vista.zona)}
      puedeActuar={membership.role !== "viewer"}
    />
  );
}
