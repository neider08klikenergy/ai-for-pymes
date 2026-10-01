import { NextRequest, NextResponse } from "next/server";
import { checkWorkspaceMember } from "@/lib/auth/workspace-access";
import { appOrigin, svc } from "@/features/inbox/services/zernio-routes";
import { syncZernioAccounts } from "@/features/inbox/services/zernio-accounts";

// Regreso desde la página de Meta/Zernio tras conectar un canal.
// Zernio agrega: connected={platform}&profileId&accountId&username, o
// error&platform&error_message si algo falló. Se vuelve a leer la lista de
// cuentas del perfil desde Zernio (no se confía en los parámetros de la URL)
// y se regresa a Settings → Integraciones con el resultado.

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const wsid = q.get("wsid") ?? "";
  const back = new URL("/settings", appOrigin(req));
  back.searchParams.set("tab", "integraciones");

  if (!UUID.test(wsid)) {
    back.searchParams.set("zernio", "error");
    back.searchParams.set("detalle", "Workspace no válido");
    return NextResponse.redirect(back);
  }

  const access = await checkWorkspaceMember(wsid, { minRole: "admin" });
  if (!access.ok) {
    back.searchParams.set("zernio", "error");
    back.searchParams.set(
      "detalle",
      "Solo un administrador del workspace puede conectar canales",
    );
    return NextResponse.redirect(back);
  }

  const platform = q.get("connected") ?? q.get("platform") ?? "";
  if (q.get("error")) {
    back.searchParams.set("zernio", "error");
    back.searchParams.set("canal", platform);
    const message = q.get("error_message") ?? q.get("error") ?? "";
    back.searchParams.set("detalle", message.slice(0, 200));
    return NextResponse.redirect(back);
  }

  try {
    const supabase = svc();
    // El perfil del callback debe ser el de este workspace.
    const { data: row } = await supabase
      .from("integrations")
      .select("config")
      .eq("workspace_id", wsid)
      .eq("provider", "zernio")
      .maybeSingle();
    const profileId = (row?.config as { profile_id?: string } | null)
      ?.profile_id;
    const returned = q.get("profileId");
    if (!profileId || (returned && returned !== profileId)) {
      back.searchParams.set("zernio", "error");
      back.searchParams.set(
        "detalle",
        "La conexión no corresponde a este workspace",
      );
      return NextResponse.redirect(back);
    }

    await syncZernioAccounts(supabase, wsid);
    back.searchParams.set("zernio", "conectado");
    back.searchParams.set("canal", platform);
  } catch (err) {
    console.error(
      "[zernio/callback] error:",
      err instanceof Error ? err.message : "unknown",
    );
    back.searchParams.set("zernio", "error");
    back.searchParams.set(
      "detalle",
      "Se conectó en Zernio, pero no se pudo leer la cuenta. Usa «Actualizar».",
    );
  }
  return NextResponse.redirect(back);
}
