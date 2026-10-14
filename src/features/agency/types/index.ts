export interface WorkspaceWithStats {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  member_count: number;
  conversation_count: number;
  /** The workspace's active WhatsApp provider, or null when not connected. */
  whatsapp_provider: "kapso" | "zernio" | null;
  /** false = suspendido por Felrick (p. ej. falta de pago). */
  is_active: boolean;
  /** Motivo de la última suspensión (solo lo ve el super admin). */
  motivo_suspension: string | null;
}

export type UseCase = "setter" | "soporte" | "agendamiento" | "general";

export interface CreateWorkspaceInput {
  name: string;
  useCase: UseCase;
  clientEmail?: string;
}

/** New client account: whether the email to choose a password went out. */
export interface ClientInvitation {
  email: string;
  enviada: boolean;
}

export type CreateWorkspaceResult =
  | {
      workspaceId: string;
      /** Webhook URL per WhatsApp provider — the client picks one in Integraciones. */
      webhookUrls: { kapso: string };
      /** Kapso's webhook URL (kept for API callers that read a single URL). */
      webhookUrl: string;
      clientInvitation?: ClientInvitation | null;
      error?: never;
    }
  | {
      workspaceId?: never;
      webhookUrls?: never;
      webhookUrl?: never;
      clientInvitation?: never;
      error: string;
    };

export type GetWorkspacesResult =
  | { workspaces: WorkspaceWithStats[]; error?: never }
  | { workspaces?: never; error: string };
