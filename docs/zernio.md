# Zernio · WhatsApp, Instagram y Facebook

Zernio es el puente hacia Meta mientras AI for PYMES pasa la verificación de su propia app. Una sola cuenta de Zernio (la de AI for PYMES) atiende a todos los clientes: cada workspace es un **perfil** de Zernio, y sus canales son **cuentas** conectadas por OAuth en la página oficial de Meta. Ni el cliente ni nosotros manejamos contraseñas.

## Configuración única (una vez para toda la plataforma)

1. **Variables en Vercel** (PowerShell, en la carpeta del proyecto):
   ```powershell
   vercel env add ZERNIO_API_KEY production
   vercel env add ZERNIO_WEBHOOK_SECRET production
   ```
   - `ZERNIO_API_KEY`: la API key de Zernio (`sk_…`).
   - `ZERNIO_WEBHOOK_SECRET`: una clave larga inventada por nosotros. Para generarla:
     ```powershell
     $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
     ```
2. **Webhook en Zernio** (zernio.com/dashboard/webhooks → crear):
   - URL: `https://ai-for-pymes.vercel.app/api/webhooks/zernio`
   - Secret: el mismo valor de `ZERNIO_WEBHOOK_SECRET`.
   - Eventos: `message.received`, `message.sent`, `message.delivered`, `message.read`, `message.failed`, `account.connected`, `account.disconnected`, `whatsapp.template.status_updated`.
3. `supabase db push` (migraciones `20261006000000_zernio_enums` y `20261006000001_zernio`) y `vercel --prod`.

## Por cada cliente (workspace)

1. **Settings → Integraciones → WhatsApp → Zernio**.
2. Botón **Conectar** en WhatsApp, Instagram y/o Facebook. Se abre la página de Meta: el dueño de la cuenta inicia sesión y acepta. Al volver, el canal aparece conectado.
   - Instagram: cuenta **profesional** (empresa o creador).
   - Facebook: una **página** (Messenger).
   - WhatsApp: número de WhatsApp Business. Si el número estaba en otro proveedor (Kapso), primero se desconecta de allá.
3. **Guardar y cambiar a Zernio**. Desde ahí, los mensajes de los tres canales llegan al inbox y los atiende el agente.

## Diferencias entre canales

| | WhatsApp | Instagram / Facebook |
|---|---|---|
| Contacto | Número de teléfono | Id del canal (sin teléfono) |
| Ventana para responder | 24 h desde el último mensaje del cliente | 24 h |
| Fuera de la ventana | Plantilla aprobada | No hay plantillas: el aviso queda como nota interna |
| Avisos de pedido (listo, pago, etc.) | Texto o plantilla | Solo dentro de 24 h; por eso el agente pide el celular |

Si una persona responde desde la bandeja de Zernio, desde la app de WhatsApp Business o desde la app de Instagram/Facebook, la conversación pasa a esa persona (la IA deja de responder), igual que antes con Kapso.
