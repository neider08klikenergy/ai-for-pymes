// Lee la configuración del módulo de pedidos para Settings → Negocio.
// Se llama con el cliente del servidor (service role) y filtra por workspace.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AjustesPedidos, CuentaPago, SedeAjuste, TarifaDomicilio } from "../lib/ajustes";

/**
 * null si el workspace no usa el módulo de pedidos (sin sedes y sin la
 * herramienta registrar_pedido activa): así un negocio sin pedidos, como un
 * hotel, no ve estas secciones.
 */
export async function cargarAjustesPedidos(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<AjustesPedidos | null> {
  const [sedesRes, cuentasRes, tarifasRes, notaRes, herramientaRes] = await Promise.all([
    supabase
      .from("sedes")
      .select("id, codigo, nombre, direccion, telefono, cupo_diario, cupo_maximo, acepta_personalizados, activa, latitud, longitud")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    supabase
      .from("cuentas_pago")
      .select("id, sede_id, tipo, banco, numero, titular, documento, activa, orden")
      .eq("workspace_id", workspaceId)
      .order("orden")
      .order("created_at"),
    supabase
      .from("tarifas_domicilio")
      .select("id, sede_id, zona, valor, activa")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    supabase
      .from("reglas_negocio")
      .select("valor")
      .eq("workspace_id", workspaceId)
      .eq("clave", "nota_pagos")
      .maybeSingle(),
    supabase
      .from("tool_configs")
      .select("enabled, tools!inner(key)")
      .eq("workspace_id", workspaceId)
      .eq("enabled", true)
      .eq("tools.key", "registrar_pedido")
      .limit(1),
  ]);

  // Antes de aplicar la migración las tablas no existen: no mostrar nada.
  if (sedesRes.error) return null;

  // NUMERIC puede llegar como texto: las coordenadas se pasan a número
  const sedes = ((sedesRes.data ?? []) as SedeAjuste[]).map((s) => ({
    ...s,
    latitud: s.latitud === null ? null : Number(s.latitud),
    longitud: s.longitud === null ? null : Number(s.longitud),
  }));
  const usaPedidos = sedes.length > 0 || (herramientaRes.data ?? []).length > 0;
  if (!usaPedidos) return null;

  const { data: vistaPrevia } = await supabase.rpc("pd_datos_pago", {
    p_ws: workspaceId,
    p_sede_id: null,
  });

  return {
    sedes,
    cuentas: cuentasRes.error ? [] : ((cuentasRes.data ?? []) as CuentaPago[]),
    tarifas: tarifasRes.error ? [] : ((tarifasRes.data ?? []) as TarifaDomicilio[]),
    notaPagos: typeof notaRes.data?.valor === "string" ? notaRes.data.valor : "",
    vistaPrevia: typeof vistaPrevia === "string" && vistaPrevia.trim() ? vistaPrevia : null,
  };
}
