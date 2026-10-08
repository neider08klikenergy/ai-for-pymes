"use client";

import {
  Select,
  SelectItem,
  SelectValue,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogTitle,
  DialogFooter,
  DialogHeader,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Copy,
  Users,
  Loader2,
  UserPlus,
  UserMinus,
  RefreshCw,
  CheckCheck,
  UserCheck,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type WorkspaceRole = "admin" | "manager" | "agent" | "viewer";

interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: WorkspaceRole;
  is_active: boolean;
  created_at: string;
}

interface Props {
  workspaceId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  admin: "Admin",
  manager: "Manager",
  agent: "Agente",
  viewer: "Viewer",
};

// Role badge styles using design-system tokens (dark theme)
const ROLE_BADGE: Record<WorkspaceRole, string> = {
  admin: "border-primary/30 bg-primary/10 text-primary",
  manager: "border-info/30 bg-info/10 text-info",
  agent: "border-success/30 bg-success/10 text-success",
  viewer: "border-border bg-muted text-muted-foreground",
};

const SELECTABLE_ROLES: WorkspaceRole[] = [
  "admin",
  "manager",
  "agent",
  "viewer",
];

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ──────────────────────────────────────────────────────────────────────────────

function TeamSkeleton() {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center justify-between px-4 py-3.5 ${i < 2 ? "border-b border-border" : ""}`}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────────────────

function TeamEmpty({ onInvite }: { onInvite: () => void }) {
  const t = useTranslations("ui.teamTab");
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted">
        <Users className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="font-display text-sm font-semibold text-foreground">
          {t("soloTuEnElEquipo")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("invitaAColaboradoresParaQueAccedan")}
        </p>
      </div>
      <Button size="sm" className="gap-1.5 mt-1" onClick={onInvite}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        {t("invitarMiembro")}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export function TeamTab({ workspaceId }: Props) {
  const t = useTranslations("ui.teamTab");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("agent");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviting, setInviting] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [copiedCred, setCopiedCred] = useState(false);

  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [togglingActive, setTogglingActive] = useState<string | null>(null);

  // ── Fetch team ─────────────────────────────────────────────────────────────
  const fetchTeam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/team`);
      if (!res.ok) throw new Error("Error al cargar el equipo");
      const json = (await res.json()) as { members: TeamMember[] };
      setMembers(json.members ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetchTeam resets loading/error before each (re)fetch
    fetchTeam();
  }, [fetchTeam]);

  // ── Invite ─────────────────────────────────────────────────────────────────
  function closeInvite() {
    setInviteOpen(false);
    setInviteEmail("");
    setInviteRole("agent");
    setInvitePassword("");
    setCreatedCreds(null);
    setCopiedCred(false);
  }

  function handleCopyCreds() {
    if (!createdCreds) return;
    navigator.clipboard.writeText(
      `Email: ${createdCreds.email}\nContraseña: ${createdCreds.password}`,
    );
    setCopiedCred(true);
    setTimeout(() => setCopiedCred(false), 2000);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          password: invitePassword || undefined,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        credentials?: { email: string; password: string } | null;
      };
      if (!res.ok) throw new Error(json.error ?? "Error al crear el usuario");
      await fetchTeam();
      if (json.credentials) {
        // New account — show credentials for the agency to share.
        setCreatedCreds(json.credentials);
        toast.success(t("cuentaCreada"));
      } else {
        // Existing user added to the workspace.
        toast.success(`${inviteEmail} agregado al workspace`);
        closeInvite();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errorDesconocido"));
    } finally {
      setInviting(false);
    }
  }

  // ── Change role ────────────────────────────────────────────────────────────
  async function handleRoleChange(userId: string, role: WorkspaceRole) {
    setUpdatingRole(userId);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/team`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al actualizar rol");
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role } : m)),
      );
      toast.success(t("rolActualizado"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errorDesconocido"));
    } finally {
      setUpdatingRole(null);
    }
  }

  // ── Toggle active ──────────────────────────────────────────────────────────
  async function handleToggleActive(member: TeamMember) {
    const next = !member.is_active;
    setTogglingActive(member.user_id);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/team`, {
        method: next ? "PATCH" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          next
            ? { userId: member.user_id, is_active: true }
            : { userId: member.user_id },
        ),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al actualizar");
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id ? { ...m, is_active: next } : m,
        ),
      );
      toast.success(next ? t("miembroReactivado") : t("miembroDesactivado"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("errorDesconocido"));
    } finally {
      setTogglingActive(null);
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
        <TeamSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/5">
          <AlertCircle
            className="h-5 w-5 text-destructive"
            aria-hidden="true"
          />
        </div>
        <div>
          <p className="font-display text-sm font-semibold text-foreground">
            {t("noSePudoCargarElEquipo")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchTeam}
          className="gap-1.5"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t("reintentar")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-foreground">
            {t("equipo")}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("gestionaLosMiembrosQueTienenAcceso")}
        </p>
      </div>

      {/* Members list or empty state */}
      {members.length === 0 ? (
        <TeamEmpty onInvite={() => setInviteOpen(true)} />
      ) : (
        <>
          {/* Actions bar */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">
                {members.length}
              </span>{" "}
              miembro{members.length !== 1 ? "s" : ""}
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t("invitarMiembro")}
            </Button>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            {members.map((member, i) => (
              <div
                key={member.id}
                className={`flex items-center justify-between px-4 py-3.5 transition-colors duration-150 hover:bg-muted/40 group ${
                  i < members.length - 1 ? "border-b border-border" : ""
                } ${!member.is_active ? "opacity-60" : ""}`}
              >
                {/* Identity */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold font-mono ${
                      member.is_active
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                    aria-hidden="true"
                  >
                    {getInitials(member.full_name, member.email)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {member.full_name ?? member.email}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {member.email}
                    </p>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {/* Joined date — hidden on mobile */}
                  <span className="hidden sm:block text-xs text-muted-foreground font-mono mr-1">
                    {formatDate(member.created_at)}
                  </span>

                  {/* Status badge */}
                  {!member.is_active && (
                    <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-0.5 text-xs font-medium text-destructive">
                      {t("inactivo")}
                    </span>
                  )}

                  {/* Role selector */}
                  <Select
                    value={member.role}
                    onValueChange={(v) =>
                      handleRoleChange(member.user_id, v as WorkspaceRole)
                    }
                    disabled={
                      updatingRole === member.user_id || !member.is_active
                    }
                  >
                    <SelectTrigger
                      className={`h-7 w-auto gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[member.role]}`}
                      aria-label={`Cambiar rol de ${member.full_name ?? member.email}`}
                    >
                      {updatingRole === member.user_id ? (
                        <Loader2
                          className="h-3 w-3 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <SelectValue />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {SELECTABLE_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Activate / Deactivate toggle */}
                  <button
                    onClick={() => handleToggleActive(member)}
                    disabled={togglingActive === member.user_id}
                    aria-label={
                      member.is_active
                        ? `Desactivar a ${member.full_name ?? member.email}`
                        : `Reactivar a ${member.full_name ?? member.email}`
                    }
                    className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                      member.is_active
                        ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100"
                        : "text-success hover:bg-success/10"
                    }`}
                  >
                    {togglingActive === member.user_id ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : member.is_active ? (
                      <UserMinus className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <UserCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Invite dialog */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(o) => {
          if (!o) closeInvite();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-base font-semibold">
              {createdCreds ? t("credencialesDelCliente") : t("invitarMiembro")}
            </DialogTitle>
          </DialogHeader>
          {createdCreds ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                {t("comparteEstasCredencialesConElUsuario")}
              </p>
              <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-3 font-mono text-xs">
                <p className="text-foreground break-all">
                  <span className="text-muted-foreground">{t("email")} </span>
                  {createdCreds.email}
                </p>
                <p className="text-foreground break-all">
                  <span className="text-muted-foreground">
                    {t("contrasena")}{" "}
                  </span>
                  {createdCreds.password}
                </p>
              </div>
              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleCopyCreds}
                >
                  {copiedCred ? (
                    <CheckCheck
                      className="h-4 w-4 text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t("copiar")}
                </Button>
                <Button type="button" size="sm" onClick={closeInvite}>
                  {t("listo")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="invite-email"
                  className="text-sm font-medium text-foreground"
                >
                  {t("email2")}
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t("colaboradorEmpresaCom")}
                  className="font-mono text-sm"
                  aria-required="true"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="invite-role"
                  className="text-sm font-medium text-foreground"
                >
                  {t("rol")}
                </Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as WorkspaceRole)}
                >
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div>
                        <span className="font-medium">{t("admin")}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("accesoCompleto")}
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="manager">
                      <div>
                        <span className="font-medium">{t("manager")}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("gestionaAgentesYReportes")}
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="agent">
                      <div>
                        <span className="font-medium">{t("agente")}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("operaElInbox")}
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="viewer">
                      <div>
                        <span className="font-medium">{t("viewer")}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("soloLectura")}
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("seCreaSuCuentaAlInstante")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="invite-password"
                  className="text-sm font-medium text-foreground"
                >
                  {t("contrasena2")}
                  <span className="ml-1 text-muted-foreground text-xs">
                    {t("opcional")}
                  </span>
                </Label>
                <Input
                  id="invite-password"
                  type="text"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder={t("seGeneraUnaSeguraSiLo")}
                  className="font-mono text-sm"
                  autoComplete="off"
                />
              </div>
              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closeInvite}
                >
                  {t("cancelar")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={inviting}
                  aria-busy={inviting}
                  className="gap-1.5"
                >
                  {inviting ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {inviting ? t("creando") : t("crearUsuario")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
