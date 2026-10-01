import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import { syncZernioAccounts } from "@/features/inbox/services/zernio-accounts";
import { svc, zernioErrorMessage } from "@/features/inbox/services/zernio-routes";
import { zernioApiKey, zernioWebhookSecret } from "@/features/inbox/services/zernio-client";

// Canales conectados del workspace en Zernio, releídos desde Zernio.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "manager" });
  if (!auth.ok) return auth.response;

  const env = {
    apiKey: Boolean(zernioApiKey()),
    webhookSecret: Boolean(zernioWebhookSecret()),
  };
  if (!env.apiKey) return NextResponse.json({ accounts: [], env });

  try {
    const accounts = await syncZernioAccounts(svc(), workspaceId);
    return NextResponse.json({ accounts, env });
  } catch (err) {
    console.error(
      "[zernio/accounts] error:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json({ error: zernioErrorMessage(err), env }, { status: 502 });
  }
}
