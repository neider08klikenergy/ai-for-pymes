"use client";

import { useTranslations } from "next-intl";
// Menú del día por sede: lo carga el personal desde el celular.
// - Menú del día (por_dia): apagado hasta que la sede lo active.
// - Siempre disponibles: encendidos; la sede los apaga si se agotan.
// Con cantidad, el agente no vende más unidades de las que quedan (se
// descuentan al registrar cada pedido y vuelven si se cancela).

import {
  urlProductos,
  type Producto,
  type Variante,
  nombreVariante,
  disponibleEnMenu,
  type FilaDisponibilidad,
} from "../lib/catalogo";
import {
  copiarMenuDiaAnterior,
  guardarDisponibilidad,
} from "../services/productos-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useState, useTransition } from "react";
import { CalendarCheck, CopyPlus } from "lucide-react";
import { pesos, sumarDias } from "@/features/pedidos/lib/fechas";
import type { PantallaProductos } from "../services/productos-queries";

interface Props {
  workspaceId: string;
  pantalla: PantallaProductos;
  puedeEditar: boolean;
}

export function MenuDelDia({ workspaceId, pantalla, puedeEditar }: Props) {
  const t = useTranslations("ui.menuDia");
  const router = useRouter();
  const { sedes, sedeId, fecha, hoy } = pantalla;
  // Copia local: el cambio se ve al instante y se guarda en segundo plano
  const [menu, setMenu] = useState<Record<string, FilaDisponibilidad>>(
    pantalla.menu,
  );
  const [guardando, setGuardando] = useState<string | null>(null);
  const [copiando, startCopia] = useTransition();

  const activos = pantalla.productos.filter((p) => p.activo);
  const delDia = activos.filter((p) => p.modo_disponibilidad === "por_dia");
  const siempre = activos.filter((p) => p.modo_disponibilidad === "siempre");
  const cargados = delDia.reduce(
    (n, p) =>
      n +
      p.variantes.filter(
        (v) => v.activa && disponibleEnMenu("por_dia", menu[v.id]),
      ).length,
    0,
  );

  function ir(cambios: { sede?: string; fecha?: string }) {
    router.push(
      urlProductos({
        vista: "menu",
        sede: cambios.sede ?? sedeId,
        fecha: cambios.fecha ?? fecha,
      }),
      {
        scroll: false,
      },
    );
  }

  async function guardar(variante: string, fila: FilaDisponibilidad) {
    if (!sedeId) return;
    const anterior = menu[variante];
    setMenu((m) => ({ ...m, [variante]: fila }));
    setGuardando(variante);
    const r = await guardarDisponibilidad(workspaceId, {
      variante_id: variante,
      sede_id: sedeId,
      fecha,
      disponible: fila.disponible,
      cantidad: fila.cantidad,
    });
    setGuardando(null);
    if (!r.ok) {
      toast.error(r.error);
      setMenu((m) => {
        const n = { ...m };
        if (anterior) n[variante] = anterior;
        else delete n[variante];
        return n;
      });
    }
  }

  function copiarAyer() {
    if (!sedeId) return;
    startCopia(async () => {
      const r = await copiarMenuDiaAnterior(workspaceId, sedeId, fecha);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.copiados
          ? `Se cargaron ${r.copiados} productos de ayer, sin cantidades`
          : t("ayerNoHabiaProductosParaCopiar"),
      );
      router.refresh();
    });
  }

  if (!sedeId) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {t("esteWorkspaceTodaviaNoTieneSedes")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {sedes.length > 1 && (
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={t("sede")}
          >
            {sedes.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={s.id === sedeId ? "default" : "outline"}
                onClick={() => ir({ sede: s.id })}
              >
                {s.nombre.replace(/^Golosita\s+/i, "")}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => ir({ fecha: sumarDias(fecha, -1) })}
            aria-label={t("diaAnterior")}
          >
            ‹
          </Button>
          <Input
            type="date"
            value={fecha}
            onChange={(e) => e.target.value && ir({ fecha: e.target.value })}
            className="h-8 w-[150px]"
            aria-label={t("fechaDelMenu")}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => ir({ fecha: sumarDias(fecha, 1) })}
            aria-label={t("diaSiguiente")}
          >
            ›
          </Button>
          {fecha !== hoy && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => ir({ fecha: hoy })}
            >
              {t("hoy")}
            </Button>
          )}
        </div>
        {puedeEditar && delDia.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="sm:ml-auto"
            disabled={copiando}
            onClick={copiarAyer}
          >
            <CopyPlus className="h-4 w-4" aria-hidden="true" />
            {t("copiarDeAyer")}
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display font-semibold">{t("menuDelDia")}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {cargados} disponibles
          </span>
        </div>
        {delDia.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
            <CalendarCheck
              className="h-7 w-7 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="font-medium">{t("noHayProductosDeMenuDel")}</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {t("enElCatalogoCambiaLaDisponibilidad")}
            </p>
          </div>
        ) : (
          <ListaMenu
            productos={delDia}
            modo="por_dia"
            menu={menu}
            guardando={guardando}
            puedeEditar={puedeEditar}
            onGuardar={guardar}
          />
        )}
      </section>

      {siempre.length > 0 && (
        <details className="group rounded-xl border">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium flex items-center justify-between">
            <span>{t("siempreDisponiblesMarcarAgotados")}</span>
            <span className="text-xs text-muted-foreground group-open:hidden">
              {t("ver")}
            </span>
          </summary>
          <div className="border-t p-3">
            <ListaMenu
              productos={siempre}
              modo="siempre"
              menu={menu}
              guardando={guardando}
              puedeEditar={puedeEditar}
              onGuardar={guardar}
            />
          </div>
        </details>
      )}

      <p className="text-xs text-muted-foreground">
        {t("conCantidadElAgenteNoVende")}
      </p>
    </div>
  );
}

function ListaMenu({
  productos,
  modo,
  menu,
  guardando,
  puedeEditar,
  onGuardar,
}: {
  productos: Producto[];
  modo: "por_dia" | "siempre";
  menu: Record<string, FilaDisponibilidad>;
  guardando: string | null;
  puedeEditar: boolean;
  onGuardar: (variante: string, fila: FilaDisponibilidad) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {productos.map((p) => {
        const variantes = p.variantes.filter((v) => v.activa);
        if (variantes.length === 0) return null;
        return (
          <li key={p.id} className="rounded-xl border bg-card">
            <p className="px-3 pt-3 text-sm font-medium">{p.nombre}</p>
            <ul className="divide-y px-3">
              {variantes.map((v) => (
                <FilaMenu
                  key={v.id}
                  variante={v}
                  modo={modo}
                  fila={menu[v.id]}
                  ocupado={guardando === v.id}
                  puedeEditar={puedeEditar}
                  onGuardar={(f) => onGuardar(v.id, f)}
                />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function FilaMenu({
  variante: v,
  modo,
  fila,
  ocupado,
  puedeEditar,
  onGuardar,
}: {
  variante: Variante;
  modo: "por_dia" | "siempre";
  fila: FilaDisponibilidad | undefined;
  ocupado: boolean;
  puedeEditar: boolean;
  onGuardar: (f: FilaDisponibilidad) => void;
}) {
  const t = useTranslations("ui.menuDia");
  const disponible = disponibleEnMenu(modo, fila);
  const [cantidad, setCantidad] = useState(
    fila?.cantidad == null ? "" : String(fila.cantidad),
  );
  const id = `menu-${v.id}`;

  function guardarCantidad() {
    const valor =
      cantidad.trim() === "" ? null : Math.max(0, Math.floor(Number(cantidad)));
    if (valor !== null && Number.isNaN(valor)) return;
    if (valor === (fila?.cantidad ?? null)) return;
    // Poner unidades enciende el producto; 0 lo deja agotado
    onGuardar({ variante_id: v.id, disponible: true, cantidad: valor });
  }

  return (
    <li
      className={cn(
        "flex items-center gap-3 py-2",
        !disponible && "text-muted-foreground",
      )}
    >
      <Switch
        id={id}
        checked={disponible}
        disabled={!puedeEditar || ocupado}
        onCheckedChange={(on) => {
          if (on && fila?.cantidad === 0) setCantidad("");
          onGuardar({
            variante_id: v.id,
            disponible: on,
            cantidad:
              on && fila?.cantidad === 0 ? null : (fila?.cantidad ?? null),
          });
        }}
        aria-label={`${nombreVariante(v.opciones)} disponible`}
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm truncate">
          {nombreVariante(v.opciones)}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {pesos(v.precio)}
          {fila?.cantidad === 0 && t("agotado")}
        </span>
      </label>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        value={cantidad}
        disabled={!puedeEditar || ocupado}
        onChange={(e) => setCantidad(e.target.value)}
        onBlur={guardarCantidad}
        onKeyDown={(e) =>
          e.key === "Enter" && (e.target as HTMLInputElement).blur()
        }
        placeholder={t("cant")}
        className="h-8 w-20 text-right tabular-nums"
        aria-label={`Unidades de ${nombreVariante(v.opciones)}`}
      />
    </li>
  );
}
