// Fechas en la zona horaria del negocio (Golosita: America/Bogota).

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaValida(v: string | undefined | null): v is string {
  if (!v || !FECHA_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria dada. */
export function hoyEnZona(zona: string, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Suma días a una fecha YYYY-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Desfase de la zona en minutos para un instante (ej: Bogotá = -300). */
function desfaseMinutos(zona: string, instante: Date): number {
  const parte = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    timeZoneName: "longOffset",
  })
    .formatToParts(instante)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT-05:00" | "GMT"
  const m = parte?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const signo = m[1] === "-" ? -1 : 1;
  return signo * (Number(m[2]) * 60 + Number(m[3]));
}

/** Medianoche local de `fecha` en `zona`, como instante UTC. */
function medianocheLocal(fecha: string, zona: string): Date {
  const utc = new Date(`${fecha}T00:00:00Z`);
  const offset = desfaseMinutos(zona, utc);
  return new Date(utc.getTime() - offset * 60_000);
}

/** Rango [desde, hasta) en ISO UTC que cubre el día local completo. */
export function rangoDelDia(
  fecha: string,
  zona: string,
): { desde: string; hasta: string } {
  return {
    desde: medianocheLocal(fecha, zona).toISOString(),
    hasta: medianocheLocal(sumarDias(fecha, 1), zona).toISOString(),
  };
}

/** Formato regional según el idioma del panel (es → Colombia, en → EE. UU.). */
function regional(idioma?: string): string {
  return idioma === "en" ? "en-US" : "es-CO";
}

/** "3:30 p. m." en la zona del negocio. */
export function horaLocal(iso: string, zona: string, idioma?: string): string {
  return new Intl.DateTimeFormat(regional(idioma), {
    timeZone: zona,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "lun 28 sep" en la zona del negocio. */
export function fechaCorta(iso: string, zona: string, idioma?: string): string {
  return new Intl.DateTimeFormat(regional(idioma), {
    timeZone: zona,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function pesos(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n ?? 0);
}

/** Fecha local (YYYY-MM-DD) de un instante, en la zona del negocio. */
export function fechaLocalDe(iso: string, zona: string): string {
  return hoyEnZona(zona, new Date(iso));
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function esMesValido(v: string | undefined | null): v is string {
  return !!v && MES_RE.test(v);
}

/** Suma meses a un mes YYYY-MM. */
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** "Octubre de 2026" */
export function nombreMes(mes: string, idioma?: string): string {
  const t = new Intl.DateTimeFormat(regional(idioma), {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${mes}-01T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Semanas del calendario del mes (lunes a domingo), con los días de relleno
 * del mes anterior y siguiente. Cada día es YYYY-MM-DD.
 */
export function semanasDelMes(mes: string): string[][] {
  const primero = `${mes}-01`;
  const diaSemana = (new Date(`${primero}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  let dia = sumarDias(primero, -diaSemana);
  const semanas: string[][] = [];
  do {
    const semana: string[] = [];
    for (let i = 0; i < 7; i++) {
      semana.push(dia);
      dia = sumarDias(dia, 1);
    }
    semanas.push(semana);
  } while (dia.slice(0, 7) === mes);
  return semanas;
}

/** Días calendario de `desde` a `hasta` (YYYY-MM-DD). */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
