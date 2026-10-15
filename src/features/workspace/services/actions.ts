"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "./active-workspace";
import { createClient as svcClient } from "@supabase/supabase-js";

/**
 * Sets the active-workspace cookie after verifying the user is an active member
 * (or a super admin), then optionally redirects. Used by the workspace switcher
 * and the agency dashboard row actions.
 */
export async function switchWorkspace(
  workspaceId: string,
  redirectTo?: string,
): Promise<{ error?: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: membership }, { data: userRow }] = await Promise.all([
    supabase
      .from("memberships")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("users")
      .select("is_super_admin")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const allowed = Boolean(membership) || Boolean(userRow?.is_super_admin);
  if (!allowed) {
    return { error: "No tienes acceso a este workspace." };
  }

  // The Falvrick team can enter any workspace. The app (and RLS) work with
  // memberships, so it gets an admin one — hidden from the client's team list.
  if (!membership) {
    const svc = svcClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await svc.from("memberships").upsert(
      {
        workspace_id: workspaceId,
        user_id: user.id,
        role: "admin",
        is_active: true,
      },
      { onConflict: "workspace_id,user_id" },
    );
    if (error) {
      console.error("[switchWorkspace] super admin membership:", error.message);
      return { error: "No se pudo entrar a este workspace. Intenta de nuevo." };
    }
  }

  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  if (redirectTo) redirect(redirectTo);
}
