import {
  svc,
  zernioErrorMessage,
} from "@/features/inbox/services/zernio-routes";
import {
  accountsOf,
  syncZernioAccounts,
} from "@/features/inbox/services/zernio-accounts";
import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { disconnectAccount } from "@/features/inbox/services/zernio-client";

// Desconecta un canal del workspace en Zernio. Solo cuentas de ESTE workspace.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  const { id: workspaceId, accountId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "admin" });
  if (!auth.ok) return auth.response;

  const supabase = svc();
  const { data: row } = await supabase
    .from("integrations")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "zernio")
    .maybeSingle();
  const owned = accountsOf((row?.config ?? {}) as Record<string, unknown>).some(
    (a) => a.id === accountId,
  );
  if (!owned) {
    return NextResponse.json(
      { error: "Esa cuenta no es de este workspace" },
      { status: 404 },
    );
  }

  try {
    await disconnectAccount(accountId);
    const accounts = await syncZernioAccounts(supabase, workspaceId);
    return NextResponse.json({ ok: true, accounts });
  } catch (err) {
    console.error(
      "[zernio/disconnect] error:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json(
      { error: zernioErrorMessage(err) },
      { status: 502 },
    );
  }
}
