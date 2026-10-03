// Marca y remitente de los correos. Los envía la plataforma (AI for PYMES) a
// los usuarios de cada workspace, así que la marca es la nuestra; el nombre
// del negocio va dentro del correo. Todo se ajusta con variables de entorno.

export interface EmailBrand {
  /** Nombre que aparece como remitente y en el encabezado. */
  name: string;
  /** Logo en una URL https pública (los clientes de correo no cargan rutas relativas). */
  logoUrl: string | null;
  /** Color de botones y acentos. */
  color: string;
  /** Color del texto sobre el botón. */
  colorText: string;
  /** Base de los enlaces al panel. */
  appUrl: string;
}

export interface EmailSender {
  from: string;
  fromName: string;
  replyTo: string | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function emailBrand(): EmailBrand {
  const color = env("EMAIL_BRAND_COLOR");
  const colorText = env("EMAIL_BRAND_COLOR_TEXT");
  const logo = env("EMAIL_LOGO_URL");
  return {
    name: env("EMAIL_FROM_NAME") ?? "AI for PYMES",
    logoUrl: logo && logo.startsWith("https://") ? logo : null,
    color: color && HEX.test(color) ? color : "#a3e635",
    colorText: colorText && HEX.test(colorText) ? colorText : "#1a2e05",
    appUrl: (env("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000").replace(/\/+$/, ""),
  };
}

/** null si falta EMAIL_FROM: sin remitente verificado no se envía nada. */
export function emailSender(): EmailSender | null {
  const from = env("EMAIL_FROM");
  if (!from || !from.includes("@")) return null;
  return {
    from,
    fromName: env("EMAIL_FROM_NAME") ?? "AI for PYMES",
    replyTo: env("EMAIL_REPLY_TO"),
  };
}

/** Enlace absoluto al panel a partir de una ruta interna (/inbox/…). */
export function appLink(path: string | null | undefined, base: string = emailBrand().appUrl): string {
  if (!path) return base;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
