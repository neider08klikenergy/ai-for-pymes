import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { calLinkDe } from "@/features/demo/lib/solicitud";
import { SolicitudDemo } from "@/features/demo/components/solicitud-demo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("demo") };
}

export default function DemoPage() {
  // Enlace de Cal.com (ej: "felrick/demo"). Sin él, la página guarda la
  // solicitud y avisa que el equipo se comunicará.
  return (
    <SolicitudDemo calLink={calLinkDe(process.env.NEXT_PUBLIC_CALCOM_LINK)} />
  );
}
