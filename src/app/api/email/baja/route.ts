// Baja de los avisos por correo desde el enlace del pie (sin iniciar sesión).
// GET: el clic del usuario → página que pide confirmar. No cambia nada: los
//      filtros de correo abren los enlaces para revisarlos y darían de baja a
//      la persona sin que lo pidiera.
// POST: la baja. Desde el botón de esa página (formulario con confirmar=1) o
//      en un clic desde Gmail/Yahoo (cabecera List-Unsubscribe-Post).

import { NextRequest, NextResponse } from "next/server";
import { emailBrand } from "@/features/email/lib/config";
import { escapeHtml } from "@/features/email/lib/layout";
import { verificarBaja } from "@/features/email/lib/baja";
import { createClient as createSbClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Los ids del enlace si la firma es válida; null si no. */
function enlaceValido(req: NextRequest): { u: string; w: string } | null {
  const q = req.nextUrl.searchParams;
  const u = q.get("u") ?? "";
  const w = q.get("w") ?? "";
  const t = q.get("t") ?? "";
  if (!UUID.test(u) || !UUID.test(w) || !verificarBaja(u, w, t)) return null;
  return { u, w };
}

async function darDeBaja(req: NextRequest): Promise<boolean> {
  const ids = enlaceValido(req);
  if (!ids) return false;
  const { u, w } = ids;
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

type Estado = "confirmar" | "listo" | "invalido";

const TEXTOS: Record<Estado, { titulo: string; texto: string }> = {
  confirmar: {
    titulo: "¿Dejar de recibir estos correos?",
    texto:
      "Dejarás de recibir los avisos por correo de este negocio. Puedes volver a activarlos en Configuración → Equipo.",
  },
  listo: {
    titulo: "Listo, ya no recibirás estos correos",
    texto:
      "Desactivamos los avisos por correo de este negocio. Puedes volver a activarlos en Configuración → Equipo.",
  },
  invalido: {
    titulo: "El enlace no es válido",
    texto:
      "Puede que haya cambiado. Entra al panel y ajusta los avisos en Configuración → Equipo.",
  },
};

function pagina(estado: Estado, req: NextRequest): NextResponse {
  const b = emailBrand();
  const { titulo, texto } = TEXTOS[estado];
  // El formulario vuelve a esta misma URL (con u, w y t) por POST.
  const confirmar =
    estado === "confirmar"
      ? `<form method="post" action="${escapeHtml(`${req.nextUrl.pathname}${req.nextUrl.search}`)}" style="margin:0 0 16px;">
<input type="hidden" name="confirmar" value="1">
<button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:${b.color};color:${b.colorText};font-weight:600;font-size:15px;cursor:pointer;">Sí, dejar de recibirlos</button>
</form>`
      : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(titulo)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<main style="max-width:480px;margin:48px auto;padding:28px;background:#fff;border-radius:12px;border-top:4px solid ${b.color};">
<h1 style="margin:0 0 12px;font-size:20px;color:#111827;">${escapeHtml(titulo)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#374151;">${escapeHtml(texto)}</p>
${confirmar}<a href="${escapeHtml(`${b.appUrl}/settings?tab=equipo`)}" style="display:inline-block;padding:10px 18px;border-radius:8px;${estado === "confirmar" ? "color:#374151;text-decoration:underline;padding-left:0;" : `background:${b.color};color:${b.colorText};font-weight:600;text-decoration:none;`}">Ir a Configuración</a>
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">${escapeHtml(b.name)}</p>
</main></body></html>`;
  return new NextResponse(html, {
    status: estado === "invalido" ? 400 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  return pagina(enlaceValido(req) ? "confirmar" : "invalido", req);
}

/** true si el POST viene del botón de la página de confirmación. */
async function desdePagina(req: NextRequest): Promise<boolean> {
  try {
    return (await req.formData()).get("confirmar") === "1";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const ok = await darDeBaja(req);
  if (await desdePagina(req)) return pagina(ok ? "listo" : "invalido", req);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
