"use client";

// Selector ES / EN del panel. Guarda el idioma en una cookie y recarga los
// componentes del servidor para que todo salga en el idioma nuevo.

import { cn } from "@/lib/utils";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarIdioma } from "@/i18n/actions";
import { useLocale, useTranslations } from "next-intl";
import { IDIOMAS, NOMBRE_IDIOMA } from "@/i18n/config";

export function SelectorIdioma({ className }: { className?: string }) {
  const actual = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function elegir(idioma: string) {
    if (idioma === actual) return;
    startTransition(async () => {
      await cambiarIdioma(idioma);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("idioma")}
      className={cn(
        "flex items-center rounded-md border border-border/60 p-0.5",
        pendiente && "opacity-60",
        className,
      )}
    >
      {IDIOMAS.map((idioma) => (
        <button
          key={idioma}
          type="button"
          lang={idioma}
          onClick={() => elegir(idioma)}
          disabled={pendiente}
          aria-pressed={actual === idioma}
          title={NOMBRE_IDIOMA[idioma]}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[11px] uppercase transition-colors",
            actual === idioma
              ? "bg-primary/15 text-primary font-semibold"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {idioma}
        </button>
      ))}
    </div>
  );
}
