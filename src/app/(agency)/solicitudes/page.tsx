import {
  SolicitudesPanel,
  type SolicitudFila,
} from "@/features/demo/components/solicitudes-panel";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Solicitudes de demo",
};

export default async function SolicitudesPage() {
  // El layout de agencia ya exige super admin; RLS lo vuelve a exigir.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("solicitudes_demo")
    .select(
      "id, nombre, empresa, correo, whatsapp, sector, ciudad, sedes, canales, usa_shopify, mensajes_dia, comentario, estado, notas, demo_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <p className="mx-auto max-w-5xl rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        No se pudieron cargar las solicitudes. Revisa que la migración de
        solicitudes esté aplicada.
      </p>
    );
  }

  return <SolicitudesPanel solicitudes={(data ?? []) as SolicitudFila[]} />;
}
