// ¿El workspace está activo? Felrick lo suspende desde Agencia → Workspaces
// (por ejemplo, por falta de pago). Suspendido: los mensajes entrantes se
// guardan pero el agente no responde, no sale ningún envío y no se gasta IA.
//
// Falla abierto: si la consulta falla, cuenta como activo. Es un corte
// comercial, no de seguridad, y un error de base de datos no debe dejar sin
// servicio a un cliente que sí pagó.

import {
  createClient as svcClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

function svc(): SupabaseClient {
  return svcClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function workspaceActivo(
  workspaceId: string,
  db: SupabaseClient = svc(),
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("workspaces")
      .select("is_active")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) return true;
    return (data as { is_active?: boolean } | null)?.is_active !== false;
  } catch {
    return true;
  }
}
