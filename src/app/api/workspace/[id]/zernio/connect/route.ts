import {
  readJsonBody,
  requireWorkspaceMember,
} from "@/lib/auth/workspace-access";
import {
  getConnectUrl,
  ZERNIO_PLATFORMS,
} from "@/features/inbox/services/zernio-client";
import {
  svc,
  appOrigin,
  zernioErrorMessage,
} from "@/features/inbox/services/zernio-routes";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { ensureZernioProfile } from "@/features/inbox/services/zernio-accounts";

// Inicia la conexión de un canal (WhatsApp, Instagram o Facebook) del
// workspace: crea su perfil en Zernio la primera vez y devuelve la URL de la
// página oficial de Meta. Al terminar, Meta/Zernio devuelven al usuario a
// /api/zernio/callback.

const bodySchema = z.object({ platform: z.enum(ZERNIO_PLATFORMS) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;
  const auth = await requireWorkspaceMember(workspaceId, { minRole: "admin" });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = bodySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Canal no válido" }, { status: 400 });
  }

  try {
    const supabase = svc();
    const profileId = await ensureZernioProfile(supabase, workspaceId);
    const redirectUrl = `${appOrigin(req)}/api/zernio/callback?wsid=${workspaceId}`;
    const authUrl = await getConnectUrl({
      platform: parsed.data.platform,
      profileId,
      redirectUrl,
      brandName: "AI for PYMES",
    });
    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error(
      "[zernio/connect] error:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json(
      { error: zernioErrorMessage(err) },
      { status: 502 },
    );
  }
}
