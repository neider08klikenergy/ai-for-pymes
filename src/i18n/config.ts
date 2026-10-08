// Idiomas del panel. El idioma de cada persona se guarda en una cookie (por
// navegador) y las URLs no cambian. Los textos están en /messages/<idioma>.json.
//
// Esto es el idioma de la PLATAFORMA (menús, botones). El idioma en que el
// agente le contesta al cliente es otra cosa: Settings → Agentes →
// "Responder en el idioma del cliente".

export const IDIOMAS = ["es", "en"] as const;
export type Idioma = (typeof IDIOMAS)[number];

export const IDIOMA_POR_DEFECTO: Idioma = "es";
export const COOKIE_IDIOMA = "felrick_idioma";

export const NOMBRE_IDIOMA: Record<Idioma, string> = {
  es: "Español",
  en: "English",
};

export function esIdioma(v: unknown): v is Idioma {
  return typeof v === "string" && (IDIOMAS as readonly string[]).includes(v);
}
