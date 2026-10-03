// Baja de los avisos por correo desde el enlace del pie (sin iniciar sesión).
// GET: el clic del usuario → página de confirmación.
// POST: baja en un clic que piden Gmail/Yahoo (cabecera List-Unsubscribe-Post).

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { verificarBaja } from "@/features/email/lib/baja";
import { emailBrand } from "@/features/email/lib/config";
import { escapeHtml } from "@/features/email/lib/layout";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function darDeBaja(req: NextRequest): Promise<boolean> {
  const q = req.nextUrl.searchParams;
  const u = q.get("u") ?? "";
  const w = q.get("w") ?? "";
  const t = q.get("t") ?? "";
  if (!UUID.test(u) || !UUID.test(w) || !verificarBaja(u, w, t)) return false;
  const { error } = await svc()
    .from("preferencias_correo")
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq("user_id", u)
    .eq("workspace_id", w);
  if (error) {
    console.error("[email/baja] no se pudo desactivar:", error.message);
    return false;
  }
  return true;
}

function pagina(ok: boolean): NextResponse {
  const b = emailBrand();
  const titulo = ok ? "Listo, ya no recibirás estos correos" : "El enlace no es válido";
  const texto = ok
    ? "Desactivamos los avisos por correo de este negocio. Puedes volver a activarlos en Configuración → Equipo."
    : "Puede que haya cambiado. Entra al panel y ajusta los avisos en Configuración → Equipo.";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(titulo)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<main style="max-width:480px;margin:48px auto;padding:28px;background:#fff;border-radius:12px;border-top:4px solid ${b.color};">
<h1 style="margin:0 0 12px;font-size:20px;color:#111827;">${escapeHtml(titulo)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#374151;">${escapeHtml(texto)}</p>
<a href="${escapeHtml(`${b.appUrl}/settings?tab=equipo`)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${b.color};color:${b.colorText};font-weight:600;text-decoration:none;">Ir a Configuración</a>
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">${escapeHtml(b.name)}</p>
</main></body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  return pagina(await darDeBaja(req));
}

export async function POST(req: NextRequest) {
  const ok = await darDeBaja(req);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
