// Envía por correo los avisos nuevos de la campana. Lo llama el cron de cada
// minuto: toma las notificaciones pendientes, busca quién las quiere por
// correo y las envía. Un fallo aquí nunca debe frenar el resto del cron.

import { createClient as createSbClient } from "@supabase/supabase-js";
import { emailSender } from "../lib/config";
import { elegirDestinatarios, type MiembroCorreo, type PreferenciaCorreo } from "../lib/destinatarios";
import { isTipoCorreo } from "../lib/tipos";
import { enviarCorreo } from "./enviar";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface NotificacionRow {
  id: string;
  workspace_id: string;
  tipo: string;
  titulo: string;
  cuerpo: string | null;
  enlace: string | null;
}

export interface ResumenCorreos {
  notificaciones: number;
  enviados: number;
  fallidos: number;
}

const VACIO: ResumenCorreos = { notificaciones: 0, enviados: 0, fallidos: 0 };

export async function procesarCorreosPendientes(limite = 25): Promise<ResumenCorreos> {
  // Sin remitente configurado el módulo está apagado: no se toma nada, así las
  // notificaciones quedan pendientes y caducan solas (2 h) sin marcarse error.
  if (!emailSender()) return VACIO;

  const db = svc();
  const { data: claimed, error } = await db.rpc("claim_notificaciones_correo", { p_limite: limite });
  if (error) {
    // Antes de aplicar la migración la función no existe: silencio.
    if (!/claim_notificaciones_correo/.test(error.message)) {
      console.error("[email] claim falló:", error.message);
    }
    return VACIO;
  }
  const notifs = (claimed ?? []) as NotificacionRow[];
  if (notifs.length === 0) return VACIO;

  const workspaceIds = [...new Set(notifs.map((n) => n.workspace_id))];

  const [prefsRes, membersRes, wsRes] = await Promise.all([
    db
      .from("preferencias_correo")
      .select("user_id, workspace_id, activo, tipos")
      .in("workspace_id", workspaceIds)
      .eq("activo", true),
    db
      .from("memberships")
      .select("user_id, workspace_id, is_active, users(email, full_name)")
      .in("workspace_id", workspaceIds)
      .eq("is_active", true),
    db.from("workspaces").select("id, name").in("id", workspaceIds),
  ]);

  const prefs = (prefsRes.data ?? []) as PreferenciaCorreo[];
  type UsuarioJoin = { email: string | null; full_name: string | null };
  const miembros: MiembroCorreo[] = ((membersRes.data ?? []) as unknown as Array<{
    user_id: string;
    workspace_id: string;
    is_active: boolean;
    // El join llega como objeto (FK a uno) o, según el tipado, como lista.
    users: UsuarioJoin | UsuarioJoin[] | null;
  }>).map((m) => {
    const u = Array.isArray(m.users) ? m.users[0] : m.users;
    return {
      user_id: m.user_id,
      workspace_id: m.workspace_id,
      is_active: m.is_active,
      email: u?.email ?? null,
      full_name: u?.full_name ?? null,
    };
  });
  const nombres = new Map(
    ((wsRes.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]),
  );

  // Los que ya recibieron alguna de estas (un cron anterior murió a mitad).
  const { data: previos } = await db
    .from("correos_enviados")
    .select("notificacion_id, user_id")
    .in("notificacion_id", notifs.map((n) => n.id))
    .eq("estado", "enviado");
  const yaEnviado = new Set(
    ((previos ?? []) as Array<{ notificacion_id: string; user_id: string }>).map(
      (p) => `${p.notificacion_id}:${p.user_id}`,
    ),
  );

  const resumen: ResumenCorreos = { notificaciones: notifs.length, enviados: 0, fallidos: 0 };

  for (const n of notifs) {
    let estado: "enviado" | "sin_destinatarios" | "error" = "sin_destinatarios";
    if (isTipoCorreo(n.tipo)) {
      const destinos = elegirDestinatarios(n.workspace_id, n.tipo, prefs, miembros).filter(
        (d) => !yaEnviado.has(`${n.id}:${d.userId}`),
      );
      let ok = 0;
      let fail = 0;
      for (const d of destinos) {
        const r = await enviarCorreo({
          template: "notificacion",
          data: {
            tipo: n.tipo,
            titulo: n.titulo,
            cuerpo: n.cuerpo,
            enlace: n.enlace,
            workspaceName: nombres.get(n.workspace_id) ?? "Tu negocio",
          },
          to: d.email,
          toName: d.nombre,
          workspaceId: n.workspace_id,
          userId: d.userId,
          notificacionId: n.id,
        });
        if (r.ok) ok++;
        else fail++;
      }
      resumen.enviados += ok;
      resumen.fallidos += fail;
      const antes = [...yaEnviado].some((k) => k.startsWith(`${n.id}:`));
      if (ok > 0 || antes) estado = "enviado";
      else if (fail > 0) estado = "error";
    }
    await db
      .from("notificaciones")
      .update({ correo_estado: estado, correo_procesado_at: new Date().toISOString() })
      .eq("id", n.id);
  }

  return resumen;
}
