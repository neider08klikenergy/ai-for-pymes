// Punto único de salida de correos: arma la plantilla, la envía con el
// proveedor configurado y deja el envío en correos_enviados. Nunca lanza.

import { createClient as createSbClient } from "@supabase/supabase-js";
import { emailBrand, emailSender } from "../lib/config";
import { urlBaja } from "../lib/baja";
import { EMAIL_TEMPLATES, type EmailTemplateData, type EmailTemplateId } from "../templates";
import { getEmailProvider } from "../providers";

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export type ResultadoCorreo =
  | { ok: true; proveedorId: string | null }
  | { ok: false; error: string };

export async function enviarCorreo<K extends EmailTemplateId>(opts: {
  template: K;
  data: EmailTemplateData[K];
  to: string;
  toName?: string | null;
  workspaceId: string;
  /** Destinatario usuario del panel: habilita el enlace de baja y el registro por usuario. */
  userId?: string | null;
  notificacionId?: string | null;
}): Promise<ResultadoCorreo> {
  const sender = emailSender();
  if (!sender) return { ok: false, error: "Falta configurar EMAIL_FROM" };

  const brand = emailBrand();
  const unsubscribeUrl = opts.userId ? urlBaja(brand.appUrl, opts.userId, opts.workspaceId) : null;
  const template = EMAIL_TEMPLATES[opts.template] as {
    render(d: EmailTemplateData[K], ctx: { brand: typeof brand; unsubscribeUrl: string | null }): {
      subject: string;
      html: string;
      text: string;
    };
  };
  const rendered = template.render(opts.data, { brand, unsubscribeUrl });

  let proveedor = "desconocido";
  let resultado: ResultadoCorreo;
  try {
    const provider = getEmailProvider();
    proveedor = provider.id;
    const sent = await provider.send({
      to: opts.to,
      toName: opts.toName ?? null,
      from: sender.from,
      fromName: sender.fromName,
      replyTo: sender.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl,
      category: opts.template,
      metadata: {
        workspace_id: opts.workspaceId,
        ...(opts.notificacionId ? { notificacion_id: opts.notificacionId } : {}),
      },
    });
    resultado = { ok: true, proveedorId: sent.id };
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error(`[email] ${opts.template} a ${opts.to} falló:`, detalle);
    resultado = { ok: false, error: detalle.slice(0, 500) };
  }

  const { error: logError } = await svc()
    .from("correos_enviados")
    .insert({
      workspace_id: opts.workspaceId,
      user_id: opts.userId ?? null,
      notificacion_id: opts.notificacionId ?? null,
      plantilla: opts.template,
      destinatario: opts.to,
      asunto: rendered.subject,
      estado: resultado.ok ? "enviado" : "error",
      proveedor,
      proveedor_id: resultado.ok ? resultado.proveedorId : null,
      error: resultado.ok ? null : resultado.error,
    })
    .then(
      (r) => r,
      (e: unknown) => ({ error: { message: String(e) } }),
    );
  if (logError) console.warn("[email] no se pudo registrar el envío:", logError.message);

  return resultado;
}
