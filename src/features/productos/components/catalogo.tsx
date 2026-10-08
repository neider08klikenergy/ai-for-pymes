"use client";

import { useTranslations } from "next-intl";
// Catálogo del negocio: productos con sus variantes (sabor, tamaño → precio).
// Es la fuente de precios del agente (cotizar_producto).

import {
  Dialog,
  DialogTitle,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectValue,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import {
  MODOS,
  MODO_AYUDA,
  MODO_LABEL,
  type Producto,
  type Variante,
  nombreVariante,
  coincideBusqueda,
  agruparPorCategoria,
  type ModoDisponibilidad,
} from "../lib/catalogo";
import {
  borrarProducto,
  borrarVariante,
  guardarProducto,
  guardarVariante,
  importarDesdeShopify,
  type ResultadoProducto,
} from "../services/productos-actions";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Package,
  Download,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ImagenesEditor } from "./imagenes-editor";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { pesos } from "@/features/pedidos/lib/fechas";
import { BUCKET_IMAGENES, rutaImagenPropia } from "../lib/imagenes";

interface Props {
  workspaceId: string;
  productos: Producto[];
  puedeEditar: boolean;
  /** Dominio de la tienda Shopify conectada, si hay. */
  shopify: string | null;
}

type ProductoForm = {
  id: string | null;
  nombre: string;
  slug: string;
  categoria: string;
  descripcion: string;
  imagenes: string[];
  /** Fotos subidas al bucket en esta edición: si no se guardan, se borran. */
  subidas: string[];
  modo_disponibilidad: ModoDisponibilidad;
  activo: boolean;
  orden: number;
  precio_inicial: string;
};

type VarianteForm = {
  id: string | null;
  producto_id: string;
  sabor: string;
  tamano: string;
  /** Opciones distintas de sabor y tamaño (p. ej. importadas de Shopify): se conservan. */
  otras: Record<string, string>;
  porciones: string;
  incluye: string;
  precio: string;
  validado: boolean;
  activa: boolean;
  orden: number;
};

const PRODUCTO_NUEVO: ProductoForm = {
  id: null,
  nombre: "",
  slug: "",
  categoria: "",
  descripcion: "",
  imagenes: [],
  subidas: [],
  modo_disponibilidad: "siempre",
  activo: true,
  orden: 0,
  precio_inicial: "",
};

function aFormProducto(p: Producto): ProductoForm {
  return {
    id: p.id,
    nombre: p.nombre,
    slug: p.slug,
    categoria: p.categoria ?? "",
    descripcion: p.descripcion ?? "",
    imagenes: p.imagenes,
    subidas: [],
    modo_disponibilidad: p.modo_disponibilidad,
    activo: p.activo,
    orden: p.orden,
    precio_inicial: "",
  };
}

function aFormVariante(productoId: string, v?: Variante): VarianteForm {
  const { sabor = "", tamano = "", ...otras } = v?.opciones ?? {};
  return {
    id: v?.id ?? null,
    producto_id: productoId,
    sabor,
    tamano,
    otras,
    porciones: v?.porciones ?? "",
    incluye: v?.incluye ?? "",
    precio: v ? String(v.precio) : "",
    validado: v?.validado ?? true,
    activa: v?.activa ?? true,
    orden: v?.orden ?? 0,
  };
}

function rangoPrecios(p: Producto): string {
  const precios = p.variantes.filter((v) => v.activa).map((v) => v.precio);
  if (precios.length === 0) return "Sin precio";
  const min = Math.min(...precios);
  const max = Math.max(...precios);
  return min === max ? pesos(min) : `${pesos(min)} – ${pesos(max)}`;
}

export function CatalogoProductos({
  workspaceId,
  productos,
  puedeEditar,
  shopify,
}: Props) {
  const t = useTranslations("ui.catalogo");
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [producto, setProducto] = useState<ProductoForm | null>(null);
  const [variante, setVariante] = useState<VarianteForm | null>(null);
  const [pendiente, startTransition] = useTransition();
  const [importando, startImportacion] = useTransition();

  const visibles = productos.filter((p) => coincideBusqueda(p, busqueda));
  const grupos = agruparPorCategoria(visibles);
  const sinValidar = productos.reduce(
    (n, p) => n + p.variantes.filter((v) => v.activa && !v.validado).length,
    0,
  );

  function alternar(id: string) {
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function ejecutar(
    accion: () => Promise<ResultadoProducto>,
    exito: string,
    despues?: () => void,
  ) {
    startTransition(async () => {
      const r = await accion();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(exito);
      despues?.();
      router.refresh();
    });
  }

  /** Borra del bucket fotos subidas que al final no se guardaron (en segundo plano). */
  function borrarSubidas(urls: string[]) {
    const rutas = urls
      .map((u) => rutaImagenPropia(u, process.env.NEXT_PUBLIC_SUPABASE_URL))
      .filter((r): r is string => r !== null);
    if (rutas.length === 0) return;
    void createClient()
      .storage.from(BUCKET_IMAGENES)
      .remove(rutas)
      .then(({ error }) => {
        if (error)
          console.warn(
            "[productos] fotos sin guardar no borradas:",
            error.message,
          );
      });
  }

  function importar() {
    startImportacion(async () => {
      const r = await importarDesdeShopify(workspaceId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("catalogoImportadoDesdeShopify"), {
        description: r.resumen,
        duration: 10000,
      });
      router.refresh();
    });
  }

  function guardarFormProducto(f: ProductoForm) {
    ejecutar(
      () =>
        guardarProducto(workspaceId, {
          ...f,
          precio_inicial: f.id ? null : f.precio_inicial,
        }),
      "Producto guardado",
      () => {
        // Subidas en esta edición que se quitaron antes de guardar
        borrarSubidas(f.subidas.filter((u) => !f.imagenes.includes(u)));
        setProducto(null);
      },
    );
  }

  /** Cierra el editor sin guardar: las fotos subidas en esta edición sobran. */
  function cerrarProducto() {
    if (producto) borrarSubidas(producto.subidas);
    setProducto(null);
  }

  function guardarFormVariante(f: VarianteForm) {
    ejecutar(
      () =>
        guardarVariante(workspaceId, {
          id: f.id,
          producto_id: f.producto_id,
          opciones: { ...f.otras, sabor: f.sabor, tamano: f.tamano },
          porciones: f.porciones,
          incluye: f.incluye,
          precio: f.precio,
          validado: f.validado,
          activa: f.activa,
          orden: f.orden,
        }),
      "Variante guardada",
      () => {
        setAbiertos((s) => new Set(s).add(f.producto_id));
        setVariante(null);
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t("buscarProductoSaborOTamano")}
            className="pl-8"
            aria-label={t("buscarEnElCatalogo")}
          />
        </div>
        {puedeEditar && shopify && (
          <Button
            variant="outline"
            disabled={importando}
            onClick={importar}
            title={`Tienda: ${shopify}`}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {importando ? t("importando") : t("importarDesdeShopify")}
          </Button>
        )}
        {puedeEditar && (
          <Button onClick={() => setProducto(PRODUCTO_NUEVO)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("nuevoProducto")}
          </Button>
        )}
      </div>

      {puedeEditar && !shopify && (
        <p className="text-xs text-muted-foreground">
          {t("elNegocioVendeEnShopifyPuedes")}{" "}
          <Link
            href="/settings?tab=integraciones"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {t("conectaLaTiendaEnSettingsIntegraciones")}
          </Link>
          .
        </p>
      )}

      {sinValidar > 0 && (
        <p className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          {t("hay")} <strong className="tabular-nums">{sinValidar}</strong>{" "}
          {t("preciosSinValidarElAgenteLos")}
        </p>
      )}

      {productos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <Package
            className="h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">{t("todaviaNoHayProductos")}</p>
            <p className="text-sm text-muted-foreground">
              {t("creaElPrimeroParaQueEl")}
            </p>
          </div>
          {puedeEditar && (
            <Button onClick={() => setProducto(PRODUCTO_NUEVO)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("nuevoProducto")}
            </Button>
          )}
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          {t("ningunProductoCoincideCon")}
          {busqueda}&quot;.
        </p>
      ) : (
        grupos.map(([categoria, lista]) => (
          <section key={categoria} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {categoria}
            </h2>
            <ul className="flex flex-col gap-2">
              {lista.map((p) => (
                <FilaProducto
                  key={p.id}
                  producto={p}
                  abierto={abiertos.has(p.id) || busqueda.trim() !== ""}
                  puedeEditar={puedeEditar}
                  onAlternar={() => alternar(p.id)}
                  onEditar={() => setProducto(aFormProducto(p))}
                  onNuevaVariante={() => setVariante(aFormVariante(p.id))}
                  onEditarVariante={(v) => setVariante(aFormVariante(p.id, v))}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {producto && (
        <DialogoProducto
          form={producto}
          pendiente={pendiente}
          workspaceId={workspaceId}
          onCambiar={setProducto}
          onImagenes={(imagenes) =>
            setProducto((f) => (f ? { ...f, imagenes } : f))
          }
          onSubida={(url) =>
            setProducto((f) => (f ? { ...f, subidas: [...f.subidas, url] } : f))
          }
          onCerrar={cerrarProducto}
          onGuardar={() => guardarFormProducto(producto)}
          onBorrar={
            producto.id
              ? () =>
                  ejecutar(
                    () => borrarProducto(workspaceId, producto.id!),
                    "Producto borrado",
                    () => setProducto(null),
                  )
              : undefined
          }
        />
      )}

      {variante && (
        <DialogoVariante
          form={variante}
          pendiente={pendiente}
          onCambiar={setVariante}
          onCerrar={() => setVariante(null)}
          onGuardar={() => guardarFormVariante(variante)}
          onBorrar={
            variante.id
              ? () =>
                  ejecutar(
                    () => borrarVariante(workspaceId, variante.id!),
                    "Variante borrada",
                    () => setVariante(null),
                  )
              : undefined
          }
        />
      )}
    </div>
  );
}

// ── Fila de producto ─────────────────────────────────────────────────────────

function FilaProducto({
  producto: p,
  abierto,
  puedeEditar,
  onAlternar,
  onEditar,
  onNuevaVariante,
  onEditarVariante,
}: {
  producto: Producto;
  abierto: boolean;
  puedeEditar: boolean;
  onAlternar: () => void;
  onEditar: () => void;
  onNuevaVariante: () => void;
  onEditarVariante: (v: Variante) => void;
}) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.catalogo");
  const panelId = `variantes-${p.id}`;
  return (
    <li className={cn("rounded-xl border bg-card", !p.activo && "opacity-60")}>
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={abierto}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {p.imagenes[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.imagenes[0]}
              alt=""
              className="h-10 w-10 shrink-0 rounded-lg object-cover bg-muted"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Package
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium truncate">{p.nombre}</span>
              <Etiqueta>{tc(MODO_LABEL[p.modo_disponibilidad])}</Etiqueta>
              {p.origen === "shopify" && <Etiqueta>{t("shopify")}</Etiqueta>}
              {!p.activo && <Etiqueta>{t("inactivo")}</Etiqueta>}
            </span>
            <span className="block text-xs text-muted-foreground">
              {p.variantes.length === 1
                ? t("n1Variante")
                : `${p.variantes.length} variantes`}{" "}
              · {rangoPrecios(p)} · <span className="font-mono">{p.slug}</span>
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              abierto && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {puedeEditar && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onEditar}
            aria-label={`Editar ${p.nombre}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {abierto && (
        <div id={panelId} className="border-t px-3 pb-3">
          {p.variantes.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              {t("sinVariantesElAgenteNoPuede")}
            </p>
          ) : (
            <ul className="divide-y">
              {p.variantes.map((v) => (
                <li
                  key={v.id}
                  className={cn(
                    "flex items-center gap-3 py-2",
                    !v.activa && "opacity-60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">
                      {nombreVariante(v.opciones)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[v.porciones && `${v.porciones} porciones`, v.incluye]
                        .filter(Boolean)
                        .join(" · ") || " "}
                    </p>
                  </div>
                  {!v.validado && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
                      {t("porValidar")}
                    </span>
                  )}
                  {!v.activa && <Etiqueta>{t("inactiva")}</Etiqueta>}
                  <span className="text-sm font-medium tabular-nums">
                    {pesos(v.precio)}
                  </span>
                  {puedeEditar && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEditarVariante(v)}
                      aria-label={`Editar ${nombreVariante(v.opciones)}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {puedeEditar && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={onNuevaVariante}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("agregarVariante")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap">
      {children}
    </span>
  );
}

// ── Diálogos ─────────────────────────────────────────────────────────────────

function Campo({
  id,
  label,
  ayuda,
  children,
}: {
  id: string;
  label: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

function Interruptor({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="cursor-pointer">
        {label}
      </Label>
    </div>
  );
}

function PieDialogo({
  pendiente,
  onCerrar,
  onGuardar,
  onBorrar,
  textoBorrar,
}: {
  pendiente: boolean;
  onCerrar: () => void;
  onGuardar: () => void;
  onBorrar?: () => void;
  textoBorrar: string;
}) {
  const t = useTranslations("ui.catalogo");
  const [confirmar, setConfirmar] = useState(false);
  return (
    <DialogFooter className="gap-2">
      {onBorrar &&
        (confirmar ? (
          <Button
            variant="destructive"
            disabled={pendiente}
            onClick={onBorrar}
            className="sm:mr-auto"
          >
            {textoBorrar}
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setConfirmar(true)}
            className="sm:mr-auto text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("borrar")}
          </Button>
        ))}
      <Button variant="outline" onClick={onCerrar}>
        {t("cancelar")}
      </Button>
      <Button disabled={pendiente} onClick={onGuardar}>
        {t("guardar")}
      </Button>
    </DialogFooter>
  );
}

function DialogoProducto({
  form,
  pendiente,
  workspaceId,
  onCambiar,
  onImagenes,
  onSubida,
  onCerrar,
  onGuardar,
  onBorrar,
}: {
  form: ProductoForm;
  pendiente: boolean;
  workspaceId: string;
  onCambiar: (f: ProductoForm) => void;
  /** Con actualización funcional: la subida es asíncrona y no debe pisar otros campos. */
  onImagenes: (imagenes: string[]) => void;
  onSubida: (url: string) => void;
  onCerrar: () => void;
  onGuardar: () => void;
  onBorrar?: () => void;
}) {
  const tc = useTranslations("ui.constantes");
  const t = useTranslations("ui.catalogo");
  const set = (cambios: Partial<ProductoForm>) =>
    onCambiar({ ...form, ...cambios });
  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {form.id ? t("editarProducto") : t("nuevoProducto")}
          </DialogTitle>
          <DialogDescription>
            {t("losSaboresTamanosYPreciosSe")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Campo id="pr-nombre" label={t("nombre")}>
            <Input
              id="pr-nombre"
              value={form.nombre}
              onChange={(e) => set({ nombre: e.target.value })}
              placeholder={t("golovesa")}
            />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="pr-categoria" label={t("categoria")}>
              <Input
                id="pr-categoria"
                value={form.categoria}
                onChange={(e) => set({ categoria: e.target.value })}
                placeholder={t("tortasFrias")}
              />
            </Campo>
            <Campo
              id="pr-slug"
              label={t("codigoParaElAgente")}
              ayuda={form.id ? undefined : t("siLoDejasVacioSaleDel")}
            >
              <Input
                id="pr-slug"
                className="font-mono"
                value={form.slug}
                onChange={(e) => set({ slug: e.target.value })}
                placeholder="golovesa"
              />
            </Campo>
          </div>
          <Campo
            id="pr-modo"
            label={t("disponibilidad")}
            ayuda={tc(MODO_AYUDA[form.modo_disponibilidad])}
          >
            <Select
              value={form.modo_disponibilidad}
              onValueChange={(v) =>
                set({ modo_disponibilidad: v as ModoDisponibilidad })
              }
            >
              <SelectTrigger id="pr-modo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODOS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {tc(MODO_LABEL[m])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          {!form.id && (
            <Campo
              id="pr-precio"
              label={t("precioOpcional")}
              ayuda={t("paraProductosSinSaboresNiTamanos")}
            >
              <Input
                id="pr-precio"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.precio_inicial}
                onChange={(e) => set({ precio_inicial: e.target.value })}
              />
            </Campo>
          )}
          <Campo id="pr-desc" label={t("descripcion")}>
            <Textarea
              id="pr-desc"
              rows={3}
              value={form.descripcion}
              onChange={(e) => set({ descripcion: e.target.value })}
            />
          </Campo>
          <div className="grid gap-1.5">
            <Label>{t("fotos")}</Label>
            <ImagenesEditor
              workspaceId={workspaceId}
              imagenes={form.imagenes}
              onCambiar={onImagenes}
              onSubida={onSubida}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_90px] sm:items-end">
            <Interruptor
              id="pr-activo"
              label={t("activoElAgenteLoOfrece")}
              checked={form.activo}
              onChange={(v) => set({ activo: v })}
            />
            <Campo id="pr-orden" label={t("orden")}>
              <Input
                id="pr-orden"
                type="number"
                min={0}
                value={form.orden}
                onChange={(e) => set({ orden: Number(e.target.value) })}
              />
            </Campo>
          </div>
        </div>
        <PieDialogo
          pendiente={pendiente}
          onCerrar={onCerrar}
          onGuardar={onGuardar}
          onBorrar={onBorrar}
          textoBorrar={t("siBorrarProductoYVariantes")}
        />
      </DialogContent>
    </Dialog>
  );
}

function DialogoVariante({
  form,
  pendiente,
  onCambiar,
  onCerrar,
  onGuardar,
  onBorrar,
}: {
  form: VarianteForm;
  pendiente: boolean;
  onCambiar: (f: VarianteForm) => void;
  onCerrar: () => void;
  onGuardar: () => void;
  onBorrar?: () => void;
}) {
  const t = useTranslations("ui.catalogo");
  const set = (cambios: Partial<VarianteForm>) =>
    onCambiar({ ...form, ...cambios });
  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {form.id ? t("editarVariante") : t("nuevaVariante")}
          </DialogTitle>
          <DialogDescription>{t("elAgenteCotizaConElSabor")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="va-sabor" label={t("sabor")}>
              <Input
                id="va-sabor"
                value={form.sabor}
                onChange={(e) => set({ sabor: e.target.value })}
                placeholder={t("redVelvet")}
              />
            </Campo>
            <Campo id="va-tamano" label={t("tamano")}>
              <Input
                id="va-tamano"
                value={form.tamano}
                onChange={(e) => set({ tamano: e.target.value })}
                placeholder={t("n12Lb")}
              />
            </Campo>
          </div>
          {Object.keys(form.otras).length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("otrasOpciones")}{" "}
              {Object.entries(form.otras)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="va-precio" label={t("precio")}>
              <Input
                id="va-precio"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.precio}
                onChange={(e) => set({ precio: e.target.value })}
              />
            </Campo>
            <Campo id="va-porciones" label={t("porciones")}>
              <Input
                id="va-porciones"
                value={form.porciones}
                onChange={(e) => set({ porciones: e.target.value })}
                placeholder="20-25"
              />
            </Campo>
          </div>
          <Campo id="va-incluye" label={t("incluye")}>
            <Input
              id="va-incluye"
              value={form.incluye}
              onChange={(e) => set({ incluye: e.target.value })}
              placeholder={t("decoracionBasica")}
            />
          </Campo>
          <Interruptor
            id="va-validado"
            label={t("precioValidadoPorElNegocio")}
            checked={form.validado}
            onChange={(v) => set({ validado: v })}
          />
          <Interruptor
            id="va-activa"
            label={t("activaElAgenteLaCotiza")}
            checked={form.activa}
            onChange={(v) => set({ activa: v })}
          />
        </div>
        <PieDialogo
          pendiente={pendiente}
          onCerrar={onCerrar}
          onGuardar={onGuardar}
          onBorrar={onBorrar}
          textoBorrar={t("siBorrarVariante")}
        />
      </DialogContent>
    </Dialog>
  );
}
