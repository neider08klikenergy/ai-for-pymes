// Quién recibe por correo un aviso: miembros activos del workspace que
// activaron los correos y eligieron ese tipo, con un correo válido.

import type { TipoCorreo } from "./tipos";

export interface PreferenciaCorreo {
  user_id: string;
  workspace_id: string;
  activo: boolean;
  tipos: string[];
}

export interface MiembroCorreo {
  user_id: string;
  workspace_id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
}

export interface Destinatario {
  userId: string;
  email: string;
  nombre: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function elegirDestinatarios(
  workspaceId: string,
  tipo: TipoCorreo,
  preferencias: PreferenciaCorreo[],
  miembros: MiembroCorreo[],
): Destinatario[] {
  const quieren = new Set(
    preferencias
      .filter((p) => p.workspace_id === workspaceId && p.activo && p.tipos.includes(tipo))
      .map((p) => p.user_id),
  );
  const vistos = new Set<string>();
  const out: Destinatario[] = [];
  for (const m of miembros) {
    if (m.workspace_id !== workspaceId || !m.is_active || !quieren.has(m.user_id)) continue;
    const email = m.email?.trim().toLowerCase() ?? "";
    if (!EMAIL.test(email) || vistos.has(m.user_id)) continue;
    vistos.add(m.user_id);
    out.push({ userId: m.user_id, email, nombre: m.full_name?.trim() || null });
  }
  return out;
}
