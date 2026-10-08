import { APP_NAME } from "@/lib/branding";
import { getTranslations } from "next-intl/server";
import { SelectorIdioma } from "@/components/selector-idioma";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");
  return (
    <div className="relative min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4 py-10">
      <SelectorIdioma className="absolute right-4 top-4" />
      <div className="text-center space-y-1">
        <p className="font-display text-3xl font-semibold tracking-tight text-primary">
          {APP_NAME}
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("descripcionApp")}
        </p>
      </div>
      {children}
    </div>
  );
}
