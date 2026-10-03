# Avisos por correo

Los avisos de la campana (pedido nuevo, comprobante por verificar, conversación
para una persona, cliente esperando, la IA retomó) también llegan por correo a
las personas del equipo que lo activen en **Configuración → Equipo → Mis avisos
por correo**. Por defecto nadie recibe correos.

Los envía la plataforma (AI for PYMES) desde su dominio; el nombre del negocio
va dentro del correo.

## Cómo funciona

1. Se crea una notificación (trigger de la base o código).
2. El cron de cada minuto (`/api/cron/buffer-flush`) llama a
   `procesarCorreosPendientes()`: toma las pendientes con
   `claim_notificaciones_correo()`, busca quién las quiere y las envía.
3. Cada envío queda en `correos_enviados`. Una notificación llega una sola vez
   a cada persona. Las de más de 2 horas no se envían.
4. El pie trae un enlace de baja firmado (`/api/email/baja`) y las cabeceras
   `List-Unsubscribe` para la baja en un clic de Gmail.

## Estructura (`src/features/email`)

| Carpeta | Qué hay |
| --- | --- |
| `lib/` | Marca y remitente, estructura HTML común, tipos de aviso, firma de baja, elección de destinatarios |
| `templates/` | Una plantilla por correo (`notificacion`, `prueba`) y el registro `EMAIL_TEMPLATES` |
| `providers/` | SendGrid, Resend y `log` con el mismo contrato `EmailProvider` |
| `services/` | `enviarCorreo()` (punto único de salida), el procesador de notificaciones y las acciones de preferencias |
| `components/` | Sección "Mis avisos por correo" |

**Agregar un correo nuevo:** crea `templates/<nombre>.ts` (datos tipados →
asunto, HTML y texto), súmalo a `templates/index.ts` y envíalo con
`enviarCorreo({ template: "<nombre>", data, to, workspaceId })`.

**Cambiar de proveedor:** `EMAIL_PROVIDER=sendgrid | resend | log`. Otro
proveedor = un archivo en `providers/` con la forma de `EmailProvider`.

## Variables de entorno (Vercel)

```
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxx
EMAIL_FROM=avisos@tudominio.com
EMAIL_FROM_NAME=AI for PYMES
EMAIL_REPLY_TO=soporte@tudominio.com        # opcional
EMAIL_LOGO_URL=https://tudominio.com/logo.png   # opcional, https
EMAIL_BRAND_COLOR=#a3e635                   # opcional
EMAIL_BRAND_COLOR_TEXT=#1a2e05              # opcional
EMAIL_UNSUBSCRIBE_SECRET=<aleatorio>        # si falta usa CRON_SECRET
# Alternativa gratuita: EMAIL_PROVIDER=resend + RESEND_API_KEY
```

Sin `EMAIL_FROM` el módulo queda apagado: no se toma ni se envía nada.

## SendGrid

1. Settings → Sender Authentication → **Authenticate Your Domain**: agrega los
   registros CNAME que te da en el DNS del dominio (SPF/DKIM).
2. Settings → API Keys → crea una con permiso **Mail Send** (solo ese).
3. Recomendado: un registro DMARC en el DNS (`_dmarc.tudominio.com`,
   `v=DMARC1; p=none; rua=mailto:dmarc@tudominio.com`).
