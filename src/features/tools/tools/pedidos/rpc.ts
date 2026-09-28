import { createClient as createSbClient } from "@supabase/supabase-js";
import type { ToolResult } from "../../core/tool";

// ──────────────────────────────────────────────────────────────────────────────
// Módulo de pedidos (AI for PYMES) — helper compartido por las herramientas.
// Toda la lógica de negocio (precios, anticipo, 48 h, cupo, duplicados) vive en
// las funciones SQL pd_* (migración 20261001000000_modulo_pedidos). El LLM solo
// decide CUÁNDO llamar y con qué datos del cliente; nunca calcula precios.
// ──────────────────────────────────────────────────────────────────────────────

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Mensajes para el agente según el código de error de las funciones SQL. */
const GUIA_ERRORES: Record<string, string> = {
  PRECIO_NO_ENCONTRADO:
    "Ese producto no está en el tarifario. Ofrece al cliente las opciones de sabores_disponibles / tamanos_disponibles.",
  SEDE_NO_EXISTE: "Esa sede no existe. Usa uno de los códigos de la lista 'sedes'.",
  FECHA_INVALIDA:
    "Fecha no válida. Envía la fecha como YYYY-MM-DDTHH:MM (hora local) tomada de la tabla de fechas.",
  NO_DISPONIBLE:
    "No se puede agendar. Explica el motivo al cliente y ofrécele otra fecha u hora.",
  FALTA_NOMBRE_CLIENTE: "Pide el nombre de la persona que recibe el pedido.",
  FALTA_DIRECCION_DOMICILIO: "Pide la dirección de entrega para el domicilio.",
  PEDIDO_NO_ENCONTRADO:
    "No hay un pedido pendiente en esta conversación. Pide el número de pedido o toma primero el pedido.",
  COMPROBANTE_DUPLICADO:
    "Ese comprobante ya fue registrado. No lo registres otra vez; si el cliente insiste, pasa a una persona.",
  PEDIDO_CANCELADO: "Ese pedido está cancelado; pasa la conversación a una persona.",
};

/**
 * Llama una función pd_* y la convierte en ToolResult.
 * `ok` refleja el resultado de negocio (ok:false cuando la función rechaza),
 * y `output` siempre lleva el JSON completo para que el agente pueda explicar.
 */
export async function callPedidosRpc(
  fn: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { data, error } = await svc().rpc(fn, params);

  if (error) {
    console.error(`[pedidos] ${fn} failed:`, error.message);
    return {
      ok: false,
      output: null,
      error: "No pude consultar el sistema de pedidos. Pasa la conversación a una persona.",
    };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const ok = result.ok === true;
  const code = typeof result.error === "string" ? result.error : undefined;

  return {
    ok,
    output: code && GUIA_ERRORES[code] ? { ...result, guia: GUIA_ERRORES[code] } : result,
    ...(ok ? {} : { error: code ?? "ERROR_DESCONOCIDO" }),
  };
}
