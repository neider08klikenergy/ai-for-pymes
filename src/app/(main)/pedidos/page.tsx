import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ParamsPedidos } from "@/features/pedidos/lib/filtros";
import { PedidosBoard } from "@/features/pedidos/components/pedidos-board";
import { cargarVistaPedidos } from "@/features/pedidos/services/pedidos-queries";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";

export const dynamic = "force-dynamic";

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<ParamsPedidos>;
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

  const vista = await cargarVistaPedidos(
    supabase,
    membership.workspace_id,
    await searchParams,
  );

  return (
    <PedidosBoard vista={vista} puedeActuar={membership.role !== "viewer"} />
  );
}
