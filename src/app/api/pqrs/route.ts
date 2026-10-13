// Un miembro del workspace envía una PQRS desde el panel. Llega como multipart:
// workspaceId, tipo, asunto, descripcion, pagina y `file` (imagen opcional).
// Se guarda con el service role después de comprobar membresía y límite.

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient as svcClient } from "@supabase/supabase-js";
import { checkWorkspaceMember } from "@/lib/auth/workspace-access";
import { MAX_PQRS_POR_HORA, PqrsSchema } from "@/features/pqrs/lib/pqrs";
import { validateOutboundImage } from "@/features/inbox/lib/outbound-image";

function svc() {
  return svcClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const texto = (v: FormDataEntryValue | null) =>
  typeof v === "string" ? v : undefined;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Formulario no válido" },
      { status: 400 },
    );
  }

  const parsed = PqrsSchema.safeParse({
    workspaceId: texto(form.get("workspaceId")),
    tipo: texto(form.get("tipo")),
    asunto: texto(form.get("asunto")),
    descripcion: texto(form.get("descripcion")),
    pagina: texto(form.get("pagina")) || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos no válidos" },
      { status: 400 },
    );
  }
  const { workspaceId, tipo, asunto, descripcion, pagina } = parsed.data;

  const file = form.get("file");
  const imagen = file instanceof File && file.size > 0 ? file : null;
  if (imagen) {
    const invalida = validateOutboundImage(imagen);
    if (invalida)
      return NextResponse.json({ error: invalida }, { status: 400 });
  }

  const auth = await checkWorkspaceMember(workspaceId);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "No tienes acceso a este workspace" },
      { status: auth.status },
    );
  }

  const db = svc();
  const { count } = await db
    .from("pqrs")
    .select("id", { count: "exact", head: true })
    .eq("creado_por", auth.userId)
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= MAX_PQRS_POR_HORA) {
    return NextResponse.json(
      {
        error: "Enviaste muchos reportes en la última hora. Intenta más tarde.",
      },
      { status: 429 },
    );
  }

  let imagenPath: string | null = null;
  if (imagen) {
    imagenPath = `${workspaceId}/${randomUUID()}.${imagen.type === "image/png" ? "png" : "jpg"}`;
    const { error } = await db.storage
      .from("pqrs")
      .upload(imagenPath, new Uint8Array(await imagen.arrayBuffer()), {
        contentType: imagen.type,
      });
    if (error) {
      console.error("[pqrs] upload:", error.message);
      return NextResponse.json(
        { error: "No se pudo subir la imagen. Intenta de nuevo." },
        { status: 500 },
      );
    }
  }

  const { error } = await db.from("pqrs").insert({
    workspace_id: workspaceId,
    creado_por: auth.userId,
    tipo,
    asunto,
    descripcion,
    imagen_path: imagenPath,
    contexto: {
      pagina: pagina ?? null,
      navegador: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
  });
  if (error) {
    console.error("[pqrs] insert:", error.message);
    if (imagenPath) await db.storage.from("pqrs").remove([imagenPath]);
    return NextResponse.json(
      { error: "No se pudo enviar el reporte. Intenta de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
