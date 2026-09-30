"use server";

// Acciones de Settings → Negocio para el módulo de pedidos. Van con el
// cliente del usuario: RLS solo deja escribir a admin y manager
// (sedes_write, cuentas_pago_write, tarifas_domicilio_write, reglas_negocio_write).
// checkWorkspaceMember lo revisa antes para dar un mensaje claro.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMember } from "@/lib/auth/workspace-access";
import { CuentaSchema, SedeSchema, TarifaSchema, primerError } from "../lib/ajustes";

export type ResultadoAjuste = { ok: true } | { ok: false; error: string };

const Uuid = z.string().uuid();

async function puedeEditar(workspaceId: string): Promise<ResultadoAjuste> {
  if (!Uuid.safeParse(workspaceId).success) return { ok: false, error: "Workspace no válido" };
  const acceso = await checkWorkspaceMember(workspaceId, { minRole: "manager" });
  return acceso.ok ? { ok: true } : { ok: false, error: "Solo un admin o manager puede cambiar esto" };
}

function listo(): ResultadoAjuste {
  revalidatePath("/settings");
  return { ok: true };
}

/** Una sede, una cuenta o una tarifa solo puede apuntar a una sede del mismo workspace. */
async function sedeDelWorkspace(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  sedeId: string | null,
): Promise<boolean> {
  if (!sedeId) return true;
  const { data } = await supabase
    .from("sedes")
    .select("id")
    .eq("id", sedeId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return Boolean(data);
}

function errorDeBase(message: string | undefined): string {
  if (message?.includes("uq_tarifas_domicilio")) {
    return "Ya existe una tarifa para esa sede y zona";
  }
  return "No se pudo guardar. Intenta de nuevo.";
}

// ── Sedes ─────────────────────────────────────────────────────────────────────

export async function guardarSede(workspaceId: string, input: unknown): Promise<ResultadoAjuste> {
  const permiso = await puedeEditar(workspaceId);
  if (!permiso.ok) return permiso;
  const parsed = SedeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const { id, ...cambios } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sedes")
    .update(cambios)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("id");
  if (error) return { ok: false, error: errorDeBase(error.message) };
  if (!data?.length) return { ok: false, error: "Esa sede ya no existe" };
  return listo();
}

// ── Cuentas de pago ──────────────────────────────────────────────────────────

export async function guardarCuenta(workspaceId: string, input: unknown): Promise<ResultadoAjuste> {
  const permiso = await puedeEditar(workspaceId);
  if (!permiso.ok) return permiso;
  const parsed = CuentaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const { id, ...campos } = parsed.data;
  const supabase = await createClient();
  if (!(await sedeDelWorkspace(supabase, workspaceId, campos.sede_id))) {
    return { ok: false, error: "Esa sede no existe" };
  }

  if (id) {
    const { data, error } = await supabase
      .from("cuentas_pago")
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("id");
    if (error) return { ok: false, error: errorDeBase(error.message) };
    if (!data?.length) return { ok: false, error: "Esa cuenta ya no existe" };
  } else {
    const { error } = await supabase
      .from("cuentas_pago")
      .insert({ ...campos, workspace_id: workspaceId });
    if (error) return { ok: false, error: errorDeBase(error.message) };
  }
  return listo();
}

export async function borrarCuenta(workspaceId: string, id: string): Promise<ResultadoAjuste> {
  const permiso = await puedeEditar(workspaceId);
  if (!permiso.ok) return permiso;
  if (!Uuid.safeParse(id).success) return { ok: false, error: "Cuenta no válida" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cuentas_pago")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return { ok: false, error: errorDeBase(error.message) };
  return listo();
}

const NotaSchema = z.string().trim().max(600, "La nota es muy larga (máx. 600 caracteres)");

export async function guardarNotaPagos(workspaceId: string, nota: string): Promise<ResultadoAjuste> {
  const permiso = await puedeEditar(workspaceId);
  if (!permiso.ok) return permiso;
  const parsed = NotaSchema.safeParse(nota);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const supabase = await createClient();
  const { error } = parsed.data
    ? await supabase.from("reglas_negocio").upsert(
        {
          workspace_id: workspaceId,
          clave: "nota_pagos",
          valor: parsed.data,
          descripcion: "Se agrega debajo de las cuentas de pago",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,clave" },
      )
    : await supabase
        .from("reglas_negocio")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("clave", "nota_pagos");
  if (error) return { ok: false, error: errorDeBase(error.message) };
  return listo();
}

// ── Tarifas de domicilio ─────────────────────────────────────────────────────

export async function guardarTarifa(workspaceId: string, input: unknown): Promise<ResultadoAjuste> {
  const permiso = await puedeEditar(workspaceId);
  if (!permiso.ok) return permiso;
  const parsed = TarifaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const { id, ...campos } = parsed.data;
  const supabase = await createClient();
  if (!(await sedeDelWorkspace(supabase, workspaceId, campos.sede_id))) {
    return { ok: false, error: "Esa sede no existe" };
  }

  if (id) {
    const { data, error } = await supabase
      .from("tarifas_domicilio")
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .select("id");
    if (error) return { ok: false, error: errorDeBase(error.message) };
    if (!data?.length) return { ok: false, error: "Esa tarifa ya no existe" };
  } else {
    const { error } = await supabase
      .from("tarifas_domicilio")
      .insert({ ...campos, workspace_id: workspaceId });
    if (error) return { ok: false, error: errorDeBase(error.message) };
  }
  return listo();
}

export async function borrarTarifa(workspaceId: string, id: string): Promise<ResultadoAjuste> {
  const permiso = await puedeEditar(workspaceId);
  if (!permiso.ok) return permiso;
  if (!Uuid.safeParse(id).success) return { ok: false, error: "Tarifa no válida" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tarifas_domicilio")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) return { ok: false, error: errorDeBase(error.message) };
  return listo();
}

/** Prueba qué valor le daría el agente a una dirección (misma función SQL). */
export async function probarDomicilio(
  workspaceId: string,
  sedeCodigo: string,
  direccion: string,
): Promise<{ ok: true; valor: number | null; zona: string | null } | { ok: false; error: string }> {
  const acceso = await checkWorkspaceMember(workspaceId, { minRole: "agent" });
  if (!acceso.ok) return { ok: false, error: "No tienes acceso a este workspace" };
  if (direccion.trim().length < 3) return { ok: false, error: "Escribe una dirección con barrio" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pd_cotizar_domicilio", {
    p_ws: workspaceId,
    p_sede_codigo: sedeCodigo,
    p_direccion: direccion.slice(0, 300),
  });
  if (error) return { ok: false, error: "No se pudo consultar" };
  const r = (data ?? {}) as { ok?: boolean; valor?: number | null; zona?: string | null; error?: string };
  if (!r.ok) return { ok: false, error: r.error === "SEDE_NO_EXISTE" ? "Esa sede no existe" : "No se pudo consultar" };
  return { ok: true, valor: typeof r.valor === "number" ? r.valor : null, zona: r.zona ?? null };
}
