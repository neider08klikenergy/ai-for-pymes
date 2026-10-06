import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import {
  ShopifyError,
  cargarConfigShopify,
  probarShopify,
} from "@/features/productos/services/shopify-client";

// POST /api/workspace/[id]/integrations/shopify/test
// Verifica la tienda y la app guardadas pidiendo un token y el nombre de la tienda.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  // Lee la integración con el service role: mismos roles que la política
  // SELECT de integrations (admin, manager).
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const cfg = await cargarConfigShopify(workspaceId).catch(() => null);
  if (!cfg) {
    return NextResponse.json({
      ok: false,
      error: "Guarda primero la tienda y las credenciales de la app, con Shopify activo.",
    });
  }

  try {
    const shopName = await probarShopify(cfg);
    return NextResponse.json({ ok: true, shopName });
  } catch (err) {
    const error =
      err instanceof ShopifyError ? err.message : "No se pudo conectar con Shopify";
    if (!(err instanceof ShopifyError)) {
      console.error(
        "[integrations/shopify/test] error:",
        err instanceof Error ? err.message : "unknown",
      );
    }
    return NextResponse.json({ ok: false, error });
  }
}
