// Lista blanca de claves de configuración por proveedor (PUT /integrations).
//
// La config se guarda como JSON libre y el servidor la usa después como dato
// confiable (a qué número o cuenta pertenece un workspace, qué modelo usar…).
// Por eso solo se aceptan las claves que el panel realmente escribe: una clave
// que alguien mande por fuera del formulario no puede colarse en algo que el
// código lea mañana. Lo que no está en la lista se ignora, y lo ya guardado se
// conserva. Las claves que escribe el servidor (p. ej. el perfil y las cuentas
// de Zernio) no están en ninguna lista.

import { WORKSPACE_WHATSAPP_SETTINGS } from "@/features/inbox/services/whatsapp-provider";

export type ProveedorIntegracion =
  | "ycloud"
  | "kapso"
  | "zernio"
  | "openrouter"
  | "highlevel"
  | "shopify";

export const CLAVES_CONFIG: Record<ProveedorIntegracion, readonly string[]> = {
  ycloud: ["phone_number", ...WORKSPACE_WHATSAPP_SETTINGS],
  kapso: ["phone_number", "phone_number_id", "waba_id", ...WORKSPACE_WHATSAPP_SETTINGS],
  zernio: [...WORKSPACE_WHATSAPP_SETTINGS],
  // `model` es la clave antigua del modelo por defecto (getWorkspaceModel la lee).
  openrouter: ["default_model", "fallback_model", "daily_budget_tokens", "model"],
  highlevel: ["location_id", "calendar_id", "pipeline_id", "pipeline_stage_id", "timezone"],
  shopify: ["shop_domain"],
};

/** Ningún valor de estos formularios es más largo (el más largo: el mensaje de handoff). */
export const MAX_LARGO_VALOR = 1000;

function valorValido(v: unknown): boolean {
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && v.length <= MAX_LARGO_VALOR;
}

/**
 * La config del cuerpo, solo con las claves permitidas del proveedor y con
 * valores simples (texto corto, número o sí/no). `ignoradas` dice qué se
 * descartó, para el log.
 */
export function configPermitida(
  proveedor: ProveedorIntegracion,
  config: Record<string, unknown>,
): { config: Record<string, unknown>; ignoradas: string[] } {
  const permitidas = new Set(CLAVES_CONFIG[proveedor]);
  const limpia: Record<string, unknown> = {};
  const ignoradas: string[] = [];
  for (const [clave, valor] of Object.entries(config)) {
    if (permitidas.has(clave) && valorValido(valor)) limpia[clave] = valor;
    else ignoradas.push(clave);
  }
  return { config: limpia, ignoradas };
}
