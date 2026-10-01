"use client";

// Settings → Negocio: cuentas de pago, domicilios y sedes del módulo de pedidos.
// Solo se muestra si el workspace usa pedidos (ver cargarAjustesPedidos).

import {
  Plus,
  Truck,
  Store,
  Search,
  Pencil,
  Trash2,
  Landmark,
} from "lucide-react";
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
  TIPOS_CUENTA,
  describirCuenta,
  type CuentaPago,
  type SedeAjuste,
  type TipoCuenta,
  TIPO_CUENTA_LABEL,
  type AjustesPedidos,
  type TarifaDomicilio,
} from "../lib/ajustes";
import {
  guardarSede,
  borrarCuenta,
  borrarTarifa,
  guardarCuenta,
  guardarTarifa,
  probarDomicilio,
  guardarNotaPagos,
  type ResultadoAjuste,
} from "../services/ajustes-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { pesos } from "../lib/fechas";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const TODAS = "__todas";

interface Props {
  workspaceId: string;
  ajustes: AjustesPedidos;
  puedeEditar: boolean;
}

export function AjustesPedidosPanel({
  workspaceId,
  ajustes,
  puedeEditar,
}: Props) {
  return (
    <div className="space-y-6">
      <CuentasPago
        workspaceId={workspaceId}
        ajustes={ajustes}
        puedeEditar={puedeEditar}
      />
      <Domicilios
        workspaceId={workspaceId}
        ajustes={ajustes}
        puedeEditar={puedeEditar}
      />
      <Sedes
        workspaceId={workspaceId}
        sedes={ajustes.sedes}
        puedeEditar={puedeEditar}
      />
    </div>
  );
}

// ── Piezas comunes ───────────────────────────────────────────────────────────

function Seccion({
  icono: Icono,
  titulo,
  descripcion,
  accion,
  children,
}: {
  icono: React.ElementType;
  titulo: string;
  descripcion: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex gap-2.5">
          <Icono
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-sm font-semibold">{titulo}</h3>
            <p className="text-xs text-muted-foreground">{descripcion}</p>
          </div>
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

function nombreSede(sedes: SedeAjuste[], id: string | null): string {
  if (!id) return "Todas las sedes";
  return sedes.find((s) => s.id === id)?.nombre ?? "Sede eliminada";
}

function SelectorSede({
  id,
  sedes,
  valor,
  onChange,
}: {
  id: string;
  sedes: SedeAjuste[];
  valor: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <Select
      value={valor ?? TODAS}
      onValueChange={(v) => onChange(v === TODAS ? null : v)}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODAS}>Todas las sedes</SelectItem>
        {sedes.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Ejecuta una acción, muestra el resultado y recarga los datos del servidor. */
function useGuardar() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  function ejecutar(
    accion: () => Promise<ResultadoAjuste>,
    exito: string,
    alTerminar?: () => void,
  ) {
    startTransition(async () => {
      const r = await accion();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(exito);
      alTerminar?.();
      router.refresh();
    });
  }
  return { pendiente, ejecutar };
}

/** Botón de borrar en dos pasos (sin diálogos del navegador). */
function BotonBorrar({
  onBorrar,
  disabled,
}: {
  onBorrar: () => void;
  disabled?: boolean;
}) {
  const [seguro, setSeguro] = useState(false);
  return (
    <Button
      type="button"
      variant={seguro ? "destructive" : "ghost"}
      size="sm"
      disabled={disabled}
      onClick={() => (seguro ? onBorrar() : setSeguro(true))}
      onBlur={() => setSeguro(false)}
      className="mr-auto"
    >
      <Trash2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
      {seguro ? "¿Seguro? Borrar" : "Borrar"}
    </Button>
  );
}

function Campo({
  id,
  label,
  children,
  ayuda,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  ayuda?: string;
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

function Inactiva() {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      Inactiva
    </span>
  );
}

// ── Cuentas de pago ──────────────────────────────────────────────────────────

type CuentaForm = Omit<CuentaPago, "id" | "titular" | "documento"> & {
  id: string | null;
  titular: string;
  documento: string;
};

function cuentaVacia(orden: number, anterior?: CuentaPago): CuentaForm {
  return {
    id: null,
    sede_id: null,
    tipo: "ahorros",
    banco: "",
    numero: "",
    // Lo más común es que todas las cuentas sean del mismo titular.
    titular: anterior?.titular ?? "",
    documento: anterior?.documento ?? "",
    activa: true,
    orden,
  };
}

function CuentasPago({ workspaceId, ajustes, puedeEditar }: Props) {
  const { cuentas, sedes } = ajustes;
  const [editando, setEditando] = useState<CuentaForm | null>(null);
  const [nota, setNota] = useState(ajustes.notaPagos);
  const { pendiente, ejecutar } = useGuardar();

  const siguienteOrden =
    cuentas.reduce((max, c) => Math.max(max, c.orden), 0) + 1;

  return (
    <Seccion
      icono={Landmark}
      titulo="Cuentas de pago"
      descripcion="El agente las comparte cuando el cliente va a pagar. Las de una sede solo salen en pedidos de esa sede."
      accion={
        puedeEditar && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditando(cuentaVacia(siguienteOrden, cuentas[0]))}
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Agregar cuenta
          </Button>
        )
      }
    >
      {cuentas.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          Sin cuentas. Mientras no agregues una, el agente dice que una persona
          envía los datos de pago.
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-md border border-border/50">
          {cuentas.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <div className={cn("min-w-0 flex-1", !c.activa && "opacity-60")}>
                <p className="text-sm font-medium">{describirCuenta(c)}</p>
                <p className="text-xs text-muted-foreground">
                  {[c.titular, c.documento, nombreSede(sedes, c.sede_id)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {!c.activa && <Inactiva />}
              {puedeEditar && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Editar ${describirCuenta(c)}`}
                  onClick={() =>
                    setEditando({
                      ...c,
                      titular: c.titular ?? "",
                      documento: c.documento ?? "",
                    })
                  }
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="nota-pagos">Nota debajo de las cuentas</Label>
        <Textarea
          id="nota-pagos"
          rows={2}
          maxLength={600}
          value={nota}
          disabled={!puedeEditar}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Ej: Solo transferencias inmediatas. Si necesitas factura electrónica, pídela al pagar."
          className="resize-none"
        />
        {puedeEditar && nota.trim() !== ajustes.notaPagos.trim() && (
          <Button
            size="sm"
            className="w-fit"
            disabled={pendiente}
            onClick={() =>
              ejecutar(
                () => guardarNotaPagos(workspaceId, nota),
                "Nota guardada",
              )
            }
          >
            Guardar nota
          </Button>
        )}
      </div>

      {ajustes.vistaPrevia && (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            Así lo recibe el cliente (cuentas para todas las sedes)
          </p>
          <pre className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 font-sans text-xs">
            {ajustes.vistaPrevia}
          </pre>
        </div>
      )}

      {editando && (
        <Dialog open onOpenChange={(o) => !o && setEditando(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editando.id ? "Editar cuenta" : "Nueva cuenta de pago"}
              </DialogTitle>
              <DialogDescription>
                Revisa bien el número: el agente lo comparte tal cual.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo id="cp-tipo" label="Tipo">
                  <Select
                    value={editando.tipo}
                    onValueChange={(v) =>
                      setEditando({ ...editando, tipo: v as TipoCuenta })
                    }
                  >
                    <SelectTrigger id="cp-tipo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_CUENTA.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIPO_CUENTA_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <Campo
                  id="cp-banco"
                  label={
                    editando.tipo === "llave" ? "Sistema" : "Banco o entidad"
                  }
                >
                  <Input
                    id="cp-banco"
                    value={editando.banco}
                    onChange={(e) =>
                      setEditando({ ...editando, banco: e.target.value })
                    }
                    placeholder={
                      editando.tipo === "llave"
                        ? "Bre-B"
                        : editando.tipo === "billetera"
                          ? "Nequi"
                          : "Bancolombia"
                    }
                  />
                </Campo>
              </div>
              <Campo
                id="cp-numero"
                label={
                  editando.tipo === "llave"
                    ? "Llave"
                    : editando.tipo === "billetera"
                      ? "Celular"
                      : "Número de cuenta"
                }
              >
                <Input
                  id="cp-numero"
                  inputMode="text"
                  value={editando.numero}
                  onChange={(e) =>
                    setEditando({ ...editando, numero: e.target.value })
                  }
                />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo id="cp-titular" label="Titular">
                  <Input
                    id="cp-titular"
                    value={editando.titular}
                    onChange={(e) =>
                      setEditando({ ...editando, titular: e.target.value })
                    }
                    placeholder="GOLOSITA 1984 SAS"
                  />
                </Campo>
                <Campo id="cp-doc" label="Documento">
                  <Input
                    id="cp-doc"
                    value={editando.documento}
                    onChange={(e) =>
                      setEditando({ ...editando, documento: e.target.value })
                    }
                    placeholder="NIT 901524286"
                  />
                </Campo>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
                <Campo id="cp-sede" label="Sede">
                  <SelectorSede
                    id="cp-sede"
                    sedes={sedes}
                    valor={editando.sede_id}
                    onChange={(v) => setEditando({ ...editando, sede_id: v })}
                  />
                </Campo>
                <Campo id="cp-orden" label="Orden">
                  <Input
                    id="cp-orden"
                    type="number"
                    min={0}
                    value={editando.orden}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        orden: Number(e.target.value),
                      })
                    }
                  />
                </Campo>
              </div>
              <Interruptor
                id="cp-activa"
                label="Activa (el agente la comparte)"
                checked={editando.activa}
                onChange={(v) => setEditando({ ...editando, activa: v })}
              />
            </div>
            <DialogFooter className="gap-2">
              {editando.id && (
                <BotonBorrar
                  disabled={pendiente}
                  onBorrar={() =>
                    ejecutar(
                      () => borrarCuenta(workspaceId, editando.id!),
                      "Cuenta borrada",
                      () => setEditando(null),
                    )
                  }
                />
              )}
              <Button variant="outline" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button
                disabled={pendiente}
                onClick={() =>
                  ejecutar(
                    () => guardarCuenta(workspaceId, editando),
                    "Cuenta guardada",
                    () => setEditando(null),
                  )
                }
              >
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Seccion>
  );
}

// ── Domicilios ───────────────────────────────────────────────────────────────

type TarifaForm = Omit<TarifaDomicilio, "id" | "zona"> & {
  id: string | null;
  zona: string;
};

function Domicilios({ workspaceId, ajustes, puedeEditar }: Props) {
  const { tarifas, sedes } = ajustes;
  const [editando, setEditando] = useState<TarifaForm | null>(null);
  const { pendiente, ejecutar } = useGuardar();

  const [pruebaSede, setPruebaSede] = useState(sedes[0]?.codigo ?? "");
  const [pruebaDir, setPruebaDir] = useState("");
  const [probando, startProbar] = useTransition();
  const [resultado, setResultado] = useState<string | null>(null);

  function probar() {
    startProbar(async () => {
      const r = await probarDomicilio(workspaceId, pruebaSede, pruebaDir);
      if (!r.ok) {
        setResultado(r.error);
        return;
      }
      setResultado(
        r.valor === null
          ? "Sin tarifa: el agente le dice al cliente que espere y pasa la conversación al equipo."
          : `${pesos(r.valor)}${r.zona ? ` (zona ${r.zona})` : " (tarifa plana)"}`,
      );
    });
  }

  // Primero las tarifas planas, luego por zona.
  const ordenadas = [...tarifas].sort(
    (a, b) =>
      Number(Boolean(a.zona)) - Number(Boolean(b.zona)) ||
      (a.zona ?? "").localeCompare(b.zona ?? ""),
  );

  return (
    <Seccion
      icono={Truck}
      titulo="Domicilios"
      descripcion="El agente da el valor del domicilio antes de pedir el pago. Si una dirección no tiene tarifa, le dice al cliente que espere un momento y pasa la conversación al equipo para que escriba el valor en el chat."
      accion={
        puedeEditar && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setEditando({
                id: null,
                sede_id: null,
                zona: "",
                valor: 0,
                activa: true,
              })
            }
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            Agregar tarifa
          </Button>
        )
      }
    >
      {ordenadas.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          Sin tarifas: cada domicilio lo cotiza una persona del equipo.
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-md border border-border/50">
          {ordenadas.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2">
              <div className={cn("min-w-0 flex-1", !t.activa && "opacity-60")}>
                <p className="text-sm font-medium">
                  {t.zona
                    ? `Zona: ${t.zona}`
                    : "Cualquier dirección (tarifa plana)"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {nombreSede(sedes, t.sede_id)}
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {pesos(t.valor)}
              </span>
              {!t.activa && <Inactiva />}
              {puedeEditar && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Editar tarifa ${t.zona ?? "plana"}`}
                  onClick={() => setEditando({ ...t, zona: t.zona ?? "" })}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sedes.length > 0 && (
        <div className="grid gap-2 rounded-md bg-muted/30 p-3">
          <p className="text-xs font-medium">Probar una dirección</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={pruebaSede} onValueChange={setPruebaSede}>
              <SelectTrigger
                className="sm:w-[190px]"
                aria-label="Sede que despacha"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sedes.map((s) => (
                  <SelectItem key={s.id} value={s.codigo}>
                    {s.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Dirección de prueba"
              placeholder="Cra 30 # 12-10, barrio Barzal"
              value={pruebaDir}
              onChange={(e) => setPruebaDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && probar()}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={probando}
              onClick={probar}
            >
              <Search className="h-4 w-4 mr-1.5" aria-hidden="true" />
              Probar
            </Button>
          </div>
          {resultado && (
            <p className="text-xs" role="status">
              {resultado}
            </p>
          )}
        </div>
      )}

      {editando && (
        <Dialog open onOpenChange={(o) => !o && setEditando(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editando.id ? "Editar tarifa" : "Nueva tarifa de domicilio"}
              </DialogTitle>
              <DialogDescription>
                Si la dirección del cliente contiene el nombre de la zona, se
                usa esa tarifa; si no, la tarifa plana. Las tarifas de una sede
                ganan sobre las de todas las sedes.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Campo id="td-sede" label="Sede que despacha">
                <SelectorSede
                  id="td-sede"
                  sedes={sedes}
                  valor={editando.sede_id}
                  onChange={(v) => setEditando({ ...editando, sede_id: v })}
                />
              </Campo>
              <Campo
                id="td-zona"
                label="Zona o barrio"
                ayuda="Déjalo vacío para una tarifa plana (cualquier dirección)."
              >
                <Input
                  id="td-zona"
                  value={editando.zona}
                  onChange={(e) =>
                    setEditando({ ...editando, zona: e.target.value })
                  }
                  placeholder="Barzal"
                />
              </Campo>
              <Campo id="td-valor" label="Valor (COP)">
                <Input
                  id="td-valor"
                  type="number"
                  min={0}
                  step={500}
                  value={editando.valor}
                  onChange={(e) =>
                    setEditando({ ...editando, valor: Number(e.target.value) })
                  }
                />
              </Campo>
              <Interruptor
                id="td-activa"
                label="Activa"
                checked={editando.activa}
                onChange={(v) => setEditando({ ...editando, activa: v })}
              />
            </div>
            <DialogFooter className="gap-2">
              {editando.id && (
                <BotonBorrar
                  disabled={pendiente}
                  onBorrar={() =>
                    ejecutar(
                      () => borrarTarifa(workspaceId, editando.id!),
                      "Tarifa borrada",
                      () => setEditando(null),
                    )
                  }
                />
              )}
              <Button variant="outline" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button
                disabled={pendiente}
                onClick={() =>
                  ejecutar(
                    () => guardarTarifa(workspaceId, editando),
                    "Tarifa guardada",
                    () => setEditando(null),
                  )
                }
              >
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Seccion>
  );
}

// ── Sedes ─────────────────────────────────────────────────────────────────────

type SedeForm = Omit<SedeAjuste, "direccion" | "telefono" | "cupo_maximo"> & {
  direccion: string;
  telefono: string;
  cupo_maximo: string;
};

function Sedes({
  workspaceId,
  sedes,
  puedeEditar,
}: {
  workspaceId: string;
  sedes: SedeAjuste[];
  puedeEditar: boolean;
}) {
  const [editando, setEditando] = useState<SedeForm | null>(null);
  const { pendiente, ejecutar } = useGuardar();

  return (
    <Seccion
      icono={Store}
      titulo="Sedes"
      descripcion="Datos que usa el agente para cupos y entregas. Los horarios y las sedes nuevas los carga el equipo de AI for PYMES."
    >
      <ul className="divide-y divide-border/50 rounded-md border border-border/50">
        {sedes.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-3 py-2">
            <div className={cn("min-w-0 flex-1", !s.activa && "opacity-60")}>
              <p className="text-sm font-medium">{s.nombre}</p>
              <p className="text-xs text-muted-foreground">
                {s.cupo_diario > 0
                  ? `Cupo: ${s.cupo_diario} automáticos por día${
                      s.cupo_maximo && s.cupo_maximo > s.cupo_diario
                        ? `, hasta ${s.cupo_maximo} con revisión`
                        : ""
                    }`
                  : "Sin límite de cupo"}
                {s.acepta_personalizados ? " · hace personalizados" : ""}
              </p>
            </div>
            {!s.activa && <Inactiva />}
            {puedeEditar && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Editar ${s.nombre}`}
                onClick={() =>
                  setEditando({
                    ...s,
                    direccion: s.direccion ?? "",
                    telefono: s.telefono ?? "",
                    cupo_maximo:
                      s.cupo_maximo === null ? "" : String(s.cupo_maximo),
                  })
                }
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {editando && (
        <Dialog open onOpenChange={(o) => !o && setEditando(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Editar sede</DialogTitle>
              <DialogDescription>
                Código interno: {editando.codigo}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Campo id="se-nombre" label="Nombre">
                <Input
                  id="se-nombre"
                  value={editando.nombre}
                  onChange={(e) =>
                    setEditando({ ...editando, nombre: e.target.value })
                  }
                />
              </Campo>
              <Campo id="se-dir" label="Dirección">
                <Input
                  id="se-dir"
                  value={editando.direccion}
                  onChange={(e) =>
                    setEditando({ ...editando, direccion: e.target.value })
                  }
                />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo id="se-tel" label="Teléfono">
                  <Input
                    id="se-tel"
                    value={editando.telefono}
                    onChange={(e) =>
                      setEditando({ ...editando, telefono: e.target.value })
                    }
                  />
                </Campo>
                <Campo
                  id="se-cupo"
                  label="Cupo automático por día"
                  ayuda="Personalizados que el agente agenda solo. 0 = sin límite"
                >
                  <Input
                    id="se-cupo"
                    type="number"
                    min={0}
                    value={editando.cupo_diario}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        cupo_diario: Number(e.target.value),
                      })
                    }
                  />
                </Campo>
              </div>
              <Campo
                id="se-cupo-max"
                label="Tope del día (con revisión)"
                ayuda="Entre el cupo automático y este número, el agente pasa el pedido a una persona para que decida. Vacío = sin revisión."
              >
                <Input
                  id="se-cupo-max"
                  type="number"
                  min={0}
                  value={editando.cupo_maximo}
                  onChange={(e) =>
                    setEditando({ ...editando, cupo_maximo: e.target.value })
                  }
                />
              </Campo>
              <Interruptor
                id="se-pers"
                label="Hace pedidos personalizados"
                checked={editando.acepta_personalizados}
                onChange={(v) =>
                  setEditando({ ...editando, acepta_personalizados: v })
                }
              />
              <Interruptor
                id="se-activa"
                label="Activa"
                checked={editando.activa}
                onChange={(v) => setEditando({ ...editando, activa: v })}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button
                disabled={pendiente}
                onClick={() =>
                  ejecutar(
                    () => guardarSede(workspaceId, editando),
                    "Sede guardada",
                    () => setEditando(null),
                  )
                }
              >
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Seccion>
  );
}
