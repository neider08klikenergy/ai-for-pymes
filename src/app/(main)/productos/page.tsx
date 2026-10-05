import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductosBoard } from "@/features/productos/components/productos-board";
import {
  cargarPantallaProductos,
  type ParamsProductos,
} from "@/features/productos/services/productos-queries";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";

export const dynamic = "force-dynamic";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<ParamsProductos>;
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

  const pantalla = await cargarPantallaProductos(
    supabase,
    membership.workspace_id,
    await searchParams,
  );

  return (
    <ProductosBoard
      workspaceId={membership.workspace_id}
      pantalla={pantalla}
      puedeEditarCatalogo={membership.role === "admin" || membership.role === "manager"}
      puedeEditarMenu={membership.role !== "viewer"}
    />
  );
}
