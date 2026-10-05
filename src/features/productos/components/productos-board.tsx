"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { CatalogoProductos } from "./catalogo";
import { MenuDelDia } from "./menu-dia";
import { CalendarCheck, Package, Tags } from "lucide-react";
import { urlProductos, type VistaProductos } from "../lib/catalogo";
import type { PantallaProductos } from "../services/productos-queries";

interface Props {
  workspaceId: string;
  pantalla: PantallaProductos;
  /** admin y manager: crear y editar productos, variantes y precios. */
  puedeEditarCatalogo: boolean;
  /** Todos menos viewer: cargar el menú del día de las sedes. */
  puedeEditarMenu: boolean;
}

const PESTANAS: { vista: VistaProductos; label: string; Icon: React.ElementType }[] = [
  { vista: "catalogo", label: "Catálogo", Icon: Tags },
  { vista: "menu", label: "Menú del día", Icon: CalendarCheck },
];

/** Cambia cuando el servidor trae otro menú (otra sede, otra fecha o "Copiar de ayer"). */
function firmaMenu(p: PantallaProductos): string {
  const filas = Object.values(p.menu)
    .map((f) => `${f.variante_id}=${f.disponible ? 1 : 0}/${f.cantidad ?? ""}`)
    .sort()
    .join(",");
  return `${p.sedeId}:${p.fecha}:${filas}`;
}

export function ProductosBoard({ workspaceId, pantalla, puedeEditarCatalogo, puedeEditarMenu }: Props) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-primary" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold">Productos</h1>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto rounded-xl bg-muted/40 p-1 w-fit max-w-full"
        aria-label="Vistas de productos"
      >
        {PESTANAS.map(({ vista, label, Icon }) => {
          const activa = pantalla.vista === vista;
          return (
            <Link
              key={vista}
              href={urlProductos({ vista, sede: pantalla.sedeId, fecha: pantalla.fecha })}
              scroll={false}
              aria-current={activa ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                activa
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      {pantalla.error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {pantalla.error}
        </p>
      )}

      {pantalla.vista === "catalogo" ? (
        <CatalogoProductos
          workspaceId={workspaceId}
          productos={pantalla.productos}
          puedeEditar={puedeEditarCatalogo}
        />
      ) : (
        <MenuDelDia
          key={firmaMenu(pantalla)}
          workspaceId={workspaceId}
          pantalla={pantalla}
          puedeEditar={puedeEditarMenu}
        />
      )}
    </div>
  );
}
