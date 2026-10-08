// Configuración del módulo de pedidos que edita el negocio desde
// Settings → Negocio: sedes, cuentas de pago y tarifas de domicilio.

import { z } from "zod";

export const TIPOS_CUENTA = ["ahorros", "corriente", "llave", "billetera", "otro"] as const;
export type TipoCuenta = (typeof TIPOS_CUENTA)[number];

export const TIPO_CUENTA_LABEL: Record<TipoCuenta, string> = {
  ahorros: "cuentaDeAhorros",
  corriente: "cuentaCorriente",
  llave: "llaveBreB",
  billetera: "billeteraNequiDaviplata",
  otro: "otro",
};

export interface SedeAjuste {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  cupo_diario: number;
  /** Tope del día; entre cupo_diario y este decide una persona. null = igual al diario. */
  cupo_maximo: number | null;
  acepta_personalizados: boolean;
  activa: boolean;
  /** Pin en el mapa (opcional): con él, el agente envía la ubicación nativa. */
  latitud: number | null;
  longitud: number | null;
}

export interface CuentaPago {
  id: string;
  sede_id: string | null;
  tipo: TipoCuenta;
  banco: string;
  numero: string;
  titular: string | null;
  documento: string | null;
  activa: boolean;
  orden: number;
}

export interface TarifaDomicilio {
  id: string;
  sede_id: string | null;
  zona: string | null;
  valor: number;
  activa: boolean;
}

export interface AjustesPedidos {
  sedes: SedeAjuste[];
  cuentas: CuentaPago[];
  tarifas: TarifaDomicilio[];
  notaPagos: string;
  /** Texto que el agente comparte (cuentas para todas las sedes + nota). */
  vistaPrevia: string | null;
}

// ── Validación (la usan las acciones del servidor) ───────────────────────────

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** Coordenada opcional: vacía = sin pin. Se guarda con 6 decimales (~10 cm). */
const coordenadaOpcional = (limite: number) =>
  z
    .union([z.literal(""), z.null(), z.coerce.number().min(-limite).max(limite)])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : Math.round(v * 1e6) / 1e6));

export const SedeSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().trim().min(2, "Escribe el nombre de la sede").max(120),
  direccion: textoOpcional(300),
  telefono: textoOpcional(40),
  cupo_diario: z.coerce.number().int().min(0, "El cupo no puede ser negativo").max(1000),
  cupo_maximo: z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(0).max(1000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  acepta_personalizados: z.boolean(),
  activa: z.boolean(),
  latitud: coordenadaOpcional(90),
  longitud: coordenadaOpcional(180),
}).refine((s) => (s.latitud === null) === (s.longitud === null), {
  message: "La ubicación en el mapa está incompleta: márcala de nuevo",
  path: ["latitud"],
}).refine((s) => s.cupo_maximo === null || s.cupo_diario === 0 || s.cupo_maximo >= s.cupo_diario, {
  message: "El tope del día no puede ser menor que el cupo automático",
  path: ["cupo_maximo"],
});

export const CuentaSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  sede_id: z.string().uuid().nullable(),
  tipo: z.enum(TIPOS_CUENTA),
  banco: z.string().trim().min(2, "Escribe el banco o la entidad").max(60),
  numero: z
    .string()
    .trim()
    .min(4, "Escribe el número de cuenta o la llave")
    .max(40)
    .regex(/^[0-9A-Za-z@.\- ]+$/, "El número solo puede tener dígitos, letras, puntos, guiones o @"),
  titular: textoOpcional(120),
  documento: textoOpcional(40),
  activa: z.boolean(),
  orden: z.coerce.number().int().min(0).max(999),
});

export const TarifaSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  sede_id: z.string().uuid().nullable(),
  zona: textoOpcional(80),
  valor: z.coerce.number().int().min(0, "El valor no puede ser negativo").max(10_000_000),
  activa: z.boolean(),
});

export type SedeInput = z.input<typeof SedeSchema>;
export type CuentaInput = z.input<typeof CuentaSchema>;
export type TarifaInput = z.input<typeof TarifaSchema>;

/** Primer mensaje de error de zod, para mostrarlo en un toast. */
export function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos no válidos";
}

/** Cómo se ve la cuenta en la lista (igual que en el mensaje del agente). */
export function describirCuenta(c: Pick<CuentaPago, "tipo" | "banco" | "numero">): string {
  switch (c.tipo) {
    case "ahorros":
      return `${c.banco}, cuenta de ahorros ${c.numero}`;
    case "corriente":
      return `${c.banco}, cuenta corriente ${c.numero}`;
    case "llave":
      return `Llave ${c.banco} ${c.numero}`;
    default:
      return `${c.banco} ${c.numero}`;
  }
}
