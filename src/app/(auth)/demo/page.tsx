import type { Metadata } from "next";
import { calLinkDe } from "@/features/demo/lib/solicitud";
import { SolicitudDemo } from "@/features/demo/components/solicitud-demo";

export const metadata: Metadata = {
  title: "Agenda una demo",
};

export default function DemoPage() {
  // Enlace de Cal.com (ej: "felrick/demo"). Sin él, la página guarda la
  // solicitud y avisa que el equipo se comunicará.
  return (
    <SolicitudDemo calLink={calLinkDe(process.env.NEXT_PUBLIC_CALCOM_LINK)} />
  );
}
