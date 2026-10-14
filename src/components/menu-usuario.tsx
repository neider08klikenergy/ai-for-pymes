"use client";

// Menú de la cuenta (esquina derecha del header): todo lo que no es una
// sección. En el panel: Configuración y Agencia (solo super admin); en la
// agencia: Volver al panel. Siempre idioma, tema y salir, agrupados.

import {
  Sun,
  Moon,
  LogOut,
  Settings,
  Building2,
  LayoutGrid,
  UserRound,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { useTransition } from "react";
import { useTheme } from "next-themes";
import { logout } from "@/features/auth/services/actions";
import { SelectorIdioma } from "@/components/selector-idioma";

export interface EtiquetasMenu {
  cuenta: string;
  miCuenta: string;
  settings: string;
  agencia: string;
  volverAlPanel: string;
  idioma: string;
  temaClaro: string;
  temaOscuro: string;
  salir: string;
}

function iniciales(nombre: string): string {
  const partes = nombre
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((partes[0]?.[0] ?? "?") + (partes[1]?.[0] ?? "")).toUpperCase();
}

export function MenuUsuario({
  nombre,
  email,
  esSuperAdmin,
  etiquetas,
  contexto = "panel",
}: {
  nombre: string | null;
  email: string;
  esSuperAdmin: boolean;
  etiquetas: EtiquetasMenu;
  /** Dónde está el menú: cambia los accesos del primer grupo. */
  contexto?: "panel" | "agencia";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [saliendo, startSalir] = useTransition();
  const oscuro = resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={etiquetas.cuenta}
        className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-offset-background transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {iniciales(nombre ?? email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          {nombre && <p className="truncate text-sm font-medium">{nombre}</p>}
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Lo personal (para el super admin incluye la Configuración de Felrick) */}
        <DropdownMenuItem asChild>
          <Link href="/cuenta">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            {etiquetas.miCuenta}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {contexto === "agencia" ? (
          <DropdownMenuItem asChild>
            <Link href="/inbox">
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              {etiquetas.volverAlPanel}
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4" aria-hidden="true" />
                {etiquetas.settings}
              </Link>
            </DropdownMenuItem>
            {esSuperAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/workspaces">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                  {etiquetas.agencia}
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        )}
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <div className="flex items-center justify-between px-2 py-1.5 text-sm">
            <span>{etiquetas.idioma}</span>
            <SelectorIdioma />
          </div>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setTheme(oscuro ? "light" : "dark");
            }}
          >
            {oscuro ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            {oscuro ? etiquetas.temaClaro : etiquetas.temaOscuro}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={saliendo}
          onSelect={() => startSalir(() => logout())}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {etiquetas.salir}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
