import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createClient as svcClient } from "@supabase/supabase-js";
import { PqrsPanel, type PqrsFila } from "@/features/pqrs/components/pqrs-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PQRS",
};

export default async function PqrsPage() {
  // El layout de agencia ya exige super admin; RLS lo vuelve a exigir.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pqrs")
    .select("id, tipo, asunto, descripcion, imagen_path, contexto, estado, created_at, creado_por, workspaces(name)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <p className="mx-auto max-w-5xl rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        No se pudieron cargar las PQRS. Revisa que la migración de PQRS esté aplicada.
      </p>
    );
  }
  const pqrs = data ?? [];

  // Con service role: la RLS de users no deja ver a los de otros workspaces, y
  // las imágenes están en un bucket privado (enlaces firmados por 1 hora).
  const svc = svcClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ids = [...new Set(pqrs.map((p) => p.creado_por).filter((v): v is string => Boolean(v)))];
  const rutas = pqrs.map((p) => p.imagen_path).filter((r): r is string => Boolean(r));
  const [autores, firmadas] = await Promise.all([
    ids.length ? svc.from("users").select("id, email, full_name").in("id", ids) : { data: [] },
    rutas.length ? svc.storage.from("pqrs").createSignedUrls(rutas, 3600) : { data: [] },
  ]);
  const autorPor = new Map(
    ((autores.data ?? []) as Array<{ id: string; email: string; full_name: string | null }>).map((u) => [u.id, u]),
  );
  const urlPor = new Map(
    ((firmadas.data ?? []) as Array<{ path: string | null; signedUrl: string }>)
      .filter((f) => f.path && f.signedUrl)
      .map((f) => [f.path as string, f.signedUrl]),
  );

  const filas: PqrsFila[] = pqrs.map((p) => {
    const ws = (Array.isArray(p.workspaces) ? p.workspaces[0] : p.workspaces) as { name: string } | null;
    const autor = p.creado_por ? autorPor.get(p.creado_por) : undefined;
    return {
      id: p.id,
      tipo: p.tipo,
      asunto: p.asunto,
      descripcion: p.descripcion,
      estado: p.estado,
      created_at: p.created_at,
      contexto: (p.contexto ?? {}) as PqrsFila["contexto"],
      workspace: ws?.name ?? "Workspace eliminado",
      autor: autor ? (autor.full_name ?? autor.email) : "Usuario eliminado",
      autorEmail: autor?.email ?? null,
      imagenUrl: p.imagen_path ? (urlPor.get(p.imagen_path) ?? null) : null,
    };
  });

  return <PqrsPanel pqrs={filas} />;
}
