// Estructura común de todos los correos: encabezado con la marca, contenido,
// botón opcional y pie con el enlace de baja. HTML de tablas con estilos en
// línea, que es lo que respetan Gmail, Outlook y los clientes móviles.

import type { EmailBrand } from "./config";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texto plano → párrafo HTML, conservando saltos de línea. */
export function textToHtml(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

export interface LayoutInput {
  brand: EmailBrand;
  /** Texto corto que muestran los clientes junto al asunto. */
  preheader: string;
  /** Línea pequeña sobre el título, p. ej. el nombre del negocio. */
  eyebrow?: string;
  title: string;
  /** Párrafos en texto plano (se escapan). */
  paragraphs: string[];
  /** Pares etiqueta/valor que se muestran como ficha. */
  details?: Array<{ label: string; value: string }>;
  cta?: { label: string; url: string };
  /** Enlace para dejar de recibir estos correos. */
  unsubscribeUrl?: string | null;
  /** Por qué le llega este correo. */
  footerNote: string;
}

export function renderLayout(i: LayoutInput): string {
  const b = i.brand;
  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.name)}" height="32" style="display:block;height:32px;border:0;">`
    : `<span style="font-size:18px;font-weight:700;color:#111827;">${escapeHtml(b.name)}</span>`;

  const paragraphs = i.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:#374151;">${textToHtml(p)}</p>`)
    .join("");

  const details = i.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid #e5e7eb;border-radius:8px;">${i.details
        .map(
          (d, n) =>
            `<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;width:38%;${n ? "border-top:1px solid #e5e7eb;" : ""}">${escapeHtml(d.label)}</td><td style="padding:10px 14px;font-size:14px;color:#111827;${n ? "border-top:1px solid #e5e7eb;" : ""}">${textToHtml(d.value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";

  const cta = i.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td style="border-radius:8px;background:${b.color};"><a href="${escapeHtml(i.cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:${b.colorText};text-decoration:none;border-radius:8px;">${escapeHtml(i.cta.label)}</a></td></tr></table>`
    : "";

  const unsubscribe = i.unsubscribeUrl
    ? ` · <a href="${escapeHtml(i.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Dejar de recibir estos correos</a>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(i.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="padding:20px 28px;border-bottom:3px solid ${b.color};">${logo}</td></tr>
<tr><td style="padding:28px;">
${i.eyebrow ? `<p style="margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">${escapeHtml(i.eyebrow)}</p>` : ""}
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#111827;">${escapeHtml(i.title)}</h1>
${paragraphs}${details}${cta}
</td></tr>
<tr><td style="padding:16px 28px;background:#f9fafb;font-size:12px;line-height:18px;color:#6b7280;">${escapeHtml(i.footerNote)}${unsubscribe}</td></tr>
</table>
<p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">${escapeHtml(b.name)}</p>
</td></tr></table>
</body></html>`;
}

/** Versión en texto plano del mismo correo (mejora la entrega y la accesibilidad). */
export function renderText(i: LayoutInput): string {
  const lines: string[] = [];
  if (i.eyebrow) lines.push(i.eyebrow);
  lines.push(i.title, "");
  for (const p of i.paragraphs) lines.push(p, "");
  for (const d of i.details ?? []) lines.push(`${d.label}: ${d.value}`);
  if (i.details?.length) lines.push("");
  if (i.cta) lines.push(`${i.cta.label}: ${i.cta.url}`, "");
  lines.push("—", i.footerNote);
  if (i.unsubscribeUrl) lines.push(`Dejar de recibir estos correos: ${i.unsubscribeUrl}`);
  lines.push(i.brand.name);
  return lines.join("\n");
}
