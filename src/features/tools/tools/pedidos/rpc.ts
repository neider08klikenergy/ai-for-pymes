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
    "Ese producto no está en el catálogo. Ofrece al cliente las opciones de sabores_disponibles / tamanos_disponibles.",
  SEDE_NO_EXISTE: "Esa sede no existe. Usa uno de los códigos de la lista 'sedes'.",
  FECHA_INVALIDA:
    "Fecha no válida. Envía la fecha como YYYY-MM-DDTHH:MM (hora local) tomada de la tabla de fechas.",
  NO_DISPONIBLE:
    "No se puede agendar. Si el motivo es CUPO_EN_REVISION, no ofrezcas otra fecha todavía: dile al cliente que confirmas la disponibilidad con el equipo y llama pasar_a_persona. Si es AGOTADO, dile cuántas unidades quedan (cantidad_disponible) u ofrece otro producto del menú del día. Si es MENU_SIN_CARGAR, el equipo aún no cargó el menú de ese día: ofrece confirmarlo con el equipo. Con cualquier otro motivo, explícalo y ofrece otra fecha u hora.",
  FALTA_NOMBRE_CLIENTE: "Pide el nombre de la persona que recibe el pedido.",
  FALTA_DIRECCION_DOMICILIO: "Pide la dirección de entrega para el domicilio (con el barrio).",
  FALTA_VALOR_DOMICILIO:
    "Falta el valor del domicilio. Usa cotizar_domicilio; si requiere una persona, dile al cliente que en un momento le confirmas el valor y llama pasar_a_persona. No registres el pedido hasta tener el valor.",
  PEDIDO_NO_ENCONTRADO:
    "No hay un pedido pendiente en esta conversación. Pide el número de pedido o toma primero el pedido.",
  COMPROBANTE_DUPLICADO:
    "Ese comprobante ya fue registrado. No lo registres otra vez; si el cliente insiste, pasa a una persona.",
  PEDIDO_CANCELADO: "Ese pedido está cancelado; pasa la conversación a una persona.",
  PRODUCTO_POR_ENCARGO:
    "Es un producto por encargo (personalizado): sus fotos y diseños los comparte una persona del equipo. Dile al cliente que en un momento se los envían y llama pasar_a_persona con el motivo \"Enviar fotos de diseños\".",
  SIN_FOTO:
    "Ese producto no tiene foto cargada. Descríbelo y, si el cliente la quiere ver, pasa a una persona.",
  VARIOS_PRODUCTOS: "Hay varios productos con ese nombre: pregúntale al cliente cuál de las opciones quiere ver.",
  SIN_SEDES:
    "El negocio no tiene sedes cargadas. Si la base de conocimiento trae la dirección, escríbela; si no, pasa a una persona.",
  ELIGE_SEDE: "El negocio tiene varias sedes: pregúntale al cliente cuál le queda mejor (usa la lista 'sedes').",
  SIN_DIRECCION:
    "Esa sede no tiene dirección cargada. Si la base de conocimiento la trae, escríbela; si no, pasa a una persona.",
  PRODUCTO_NO_ENCONTRADO:
    "Ese producto no está en el catálogo. Ofrece ver alguno de productos_con_foto.",
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
