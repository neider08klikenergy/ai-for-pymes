"use client";

// Secciones del header: las del panel (en móvil van en la barra inferior) y
// las de la agencia. La sección actual queda resaltada.

import {
  Package,
  Receipt,
  LifeBuoy,
  Building2,
  MessageCircle,
  CalendarCheck,
  LayoutDashboard,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

const GRUPOS = {
  panel: [
    { href: "/inbox", clave: "inbox", Icono: MessageCircle },
    { href: "/pedidos", clave: "pedidos", Icono: Receipt },
    { href: "/productos", clave: "productos", Icono: Package },
    { href: "/dashboard", clave: "dashboard", Icono: LayoutDashboard },
  ],
  agencia: [
    { href: "/workspaces", clave: "workspaces", Icono: Building2 },
    { href: "/solicitudes", clave: "solicitudes", Icono: CalendarCheck },
    { href: "/pqrs", clave: "pqrs", Icono: LifeBuoy },
  ],
} as const;

type Grupo = keyof typeof GRUPOS;
export type EtiquetasNav<G extends Grupo = "panel"> = Record<
  (typeof GRUPOS)[G][number]["clave"],
  string
>;

export function NavPrincipal<G extends Grupo = "panel">({
  grupo = "panel" as G,
  etiquetas,
  variante,
  ariaLabel,
}: {
  grupo?: G;
  etiquetas: EtiquetasNav<G>;
  variante: "header" | "movil";
  ariaLabel: string;
}) {
  const secciones = GRUPOS[grupo] as readonly {
    href: string;
    clave: keyof EtiquetasNav<G>;
    Icono: typeof MessageCircle;
  }[];
  const ruta = usePathname();
  const activa = (href: string) => ruta === href || ruta.startsWith(`${href}/`);

  if (variante === "movil") {
    return (
      <nav
        aria-label={ariaLabel}
        className="md:hidden fixed bottom-0 inset-x-0 z-50 h-14 glass-strong border-t border-border/50 grid grid-cols-4"
      >
        {secciones.map(({ href, clave, Icono }) => (
          <Link
            key={href}
            href={href}
            aria-current={activa(href) ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 text-xs transition-colors",
              activa(href)
                ? "text-primary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icono className="h-5 w-5" aria-hidden="true" />
            <span>{etiquetas[clave]}</span>
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "items-center gap-0.5",
        grupo === "panel" ? "hidden md:flex" : "flex",
      )}
    >
      {secciones.map(({ href, clave, Icono }) => (
        <Link
          key={href}
          href={href}
          aria-current={activa(href) ? "page" : undefined}
          aria-label={etiquetas[clave]}
          title={etiquetas[clave]}
          className={cn(
            "flex items-center gap-2 rounded-md px-2.5 lg:px-3 h-9 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            activa(href)
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
          )}
        >
          <Icono className="h-4 w-4" aria-hidden="true" />
          {/* Entre md y lg solo el ícono: el header no alcanza para todo. */}
          <span className="hidden lg:inline">{etiquetas[clave]}</span>
        </Link>
      ))}
    </nav>
  );
}
