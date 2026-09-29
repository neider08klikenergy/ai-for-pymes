// Campana de avisos del panel.
//   GET  → últimos avisos del workspace activo + cuántos no ha visto el usuario
//   POST → marca todo como visto
// Lectura con el cliente del usuario: RLS limita a sus workspaces.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";

export const dynamic = "force-dynamic";

const LIMITE = 30;
/** Primera vez que alguien abre el panel: cuenta como no leído lo del último día. */
const VENTANA_INICIAL_MS = 24 * 3600_000;

async function contexto() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const ws = await getActiveWorkspace(supabase, user.id);
  if (!ws) return null;
  return { supabase, userId: user.id, workspaceId: ws.workspace_id };
}

export async function GET() {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { supabase, userId, workspaceId } = ctx;

  const [{ data: items, error }, { data: vista }] = await Promise.all([
    supabase
      .from("notificaciones")
      .select("id, tipo, titulo, cuerpo, enlace, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(LIMITE),
    supabase
      .from("notificaciones_vistas")
      .select("visto_hasta")
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  if (error) {
    // Sin la migración la tabla no existe: la campana queda vacía, sin romper el panel.
    return NextResponse.json({ items: [], noLeidas: 0, vistoHasta: null });
  }

  const vistoHasta =
    (vista?.visto_hasta as string | undefined) ??
    new Date(Date.now() - VENTANA_INICIAL_MS).toISOString();
  const noLeidas = (items ?? []).filter((i) => (i.created_at as string) > vistoHasta).length;

  return NextResponse.json({ items: items ?? [], noLeidas, vistoHasta });
}

export async function POST() {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { error } = await ctx.supabase.from("notificaciones_vistas").upsert(
    { user_id: ctx.userId, workspace_id: ctx.workspaceId, visto_hasta: new Date().toISOString() },
    { onConflict: "user_id,workspace_id" },
  );
  if (error) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
