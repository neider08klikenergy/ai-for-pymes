// Lo que Meta exige antes de conectar cada canal. Se muestra al pulsar
// "Conectar" para que el dueño de la cuenta llegue preparado a la página de
// Meta y la conexión no falle a mitad del proceso.

import type { Channel } from "@/features/inbox/components/channel-badge";

export interface RequisitoCanal {
  texto: string;
  /** Cómo cumplirlo, si no es obvio. */
  como?: string;
  enlace?: { url: string; label: string };
}

export interface RequisitosCanal {
  titulo: string;
  resumen: string;
  requisitos: RequisitoCanal[];
  /** Errores frecuentes en la página de Meta y qué significan. */
  siFalla: string[];
}

export const REQUISITOS_CANAL: Record<Channel, RequisitosCanal> = {
  whatsapp: {
    titulo: "Antes de conectar WhatsApp",
    resumen:
      "Se conecta la API oficial de WhatsApp Business. Ten a mano el teléfono del número que vas a conectar.",
    requisitos: [
      {
        texto: "Un número que reciba SMS o llamadas para el código de verificación.",
      },
      {
        texto: "Ese número no puede estar activo en la app de WhatsApp ni de WhatsApp Business.",
        como: "Si lo está, primero elimina la cuenta de WhatsApp de ese número desde la app (Ajustes → Cuenta → Eliminar cuenta). Usar un número nuevo es lo más fácil.",
      },
      {
        texto: "No sirve el número de prueba que da Meta.",
      },
      {
        texto: "Una cuenta personal de Facebook para iniciar sesión.",
        como: "Durante el proceso eliges o creas el portafolio comercial del negocio en Meta.",
      },
      {
        texto: "Un nombre para mostrar que coincida con la marca del negocio.",
        como: "Meta lo revisa; un nombre genérico o distinto a la marca puede ser rechazado.",
      },
    ],
    siFalla: [
      "«Número ya registrado»: el número sigue activo en la app de WhatsApp.",
      "«No cumple los requisitos»: suele ser el número de prueba de Meta o un número virtual.",
    ],
  },
  instagram: {
    titulo: "Antes de conectar Instagram",
    resumen:
      "Se conectan los mensajes directos (DM) de la cuenta de Instagram del negocio.",
    requisitos: [
      {
        texto: "La cuenta de Instagram debe ser profesional (empresa o creador).",
        como: "En la app: Configuración → Tipo de cuenta y herramientas → Cambiar a cuenta profesional.",
      },
      {
        texto: "Recomendado: la cuenta vinculada a la Página de Facebook del negocio.",
      },
      {
        texto: "Permitir el acceso a los mensajes.",
        como: "En la app: Configuración → Mensajes y respuestas a historias → Herramientas conectadas → activa «Permitir acceso a los mensajes».",
      },
      {
        texto: "Inicia sesión con la cuenta que administra el Instagram del negocio y acepta todos los permisos.",
      },
    ],
    siFalla: [
      "Si no aparece la cuenta, revisa que sea profesional y no personal.",
      "Si conecta pero no llegan mensajes, falta activar «Permitir acceso a los mensajes».",
    ],
  },
  facebook: {
    titulo: "Antes de conectar Facebook",
    resumen:
      "Se conecta Messenger de la Página de Facebook del negocio, no un perfil personal.",
    requisitos: [
      {
        texto: "Una Página de Facebook del negocio.",
        como: "Si no la tienes, créala antes de conectar.",
        enlace: { url: "https://www.facebook.com/pages/create", label: "Crear una Página" },
      },
      {
        texto: "Tu usuario de Facebook debe ser administrador de esa Página (control total).",
      },
      {
        texto: "En la ventana de permisos, selecciona la Página y no desmarques ningún permiso.",
      },
    ],
    siFalla: [
      "Si no aparece la Página, tu usuario no es administrador de ella.",
      "Si conecta pero no llegan mensajes, vuelve a conectar y acepta todos los permisos.",
    ],
  },
};
