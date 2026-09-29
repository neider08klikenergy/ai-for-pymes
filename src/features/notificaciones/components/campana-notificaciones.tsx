"use client";

// Campana de avisos del panel: contador, sonido y alerta del navegador.
// Consulta /api/notificaciones cada 30 s y al volver a la pestaña.

import {
  Bot,
  Bell,
  Clock,
  Wallet,
  Receipt,
  BellRing,
  UserRound,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";

interface Notificacion {
  id: string;
  tipo:
    | "handoff"
    | "cliente_esperando"
    | "ia_retomo"
    | "pedido_nuevo"
    | "pago_por_verificar";
  titulo: string;
  cuerpo: string | null;
  enlace: string | null;
  created_at: string;
}

const INTERVALO_MS = 30_000;

const ICONO: Record<
  Notificacion["tipo"],
  { Icon: React.ElementType; clase: string }
> = {
  handoff: { Icon: UserRound, clase: "bg-warning/15 text-warning" },
  cliente_esperando: {
    Icon: Clock,
    clase: "bg-destructive/15 text-destructive",
  },
  ia_retomo: { Icon: Bot, clase: "bg-primary/15 text-primary" },
  pedido_nuevo: { Icon: Receipt, clase: "bg-info/15 text-info" },
  pago_por_verificar: { Icon: Wallet, clase: "bg-warning/15 text-warning" },
};

/** Los urgentes suenan y avisan aunque la pestaña no esté a la vista. */
const URGENTES = new Set<Notificacion["tipo"]>([
  "handoff",
  "cliente_esperando",
  "pago_por_verificar",
]);

function haceCuanto(iso: string): string {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Dos tonos cortos con Web Audio (sin archivos de sonido). */
function sonar() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(
        0.2,
        ctx.currentTime + i * 0.18 + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + i * 0.18 + 0.16,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // Sin audio (navegador bloqueado hasta que el usuario interactúe): no pasa nada.
  }
}

export function CampanaNotificaciones() {
  const router = useRouter();
  const [items, setItems] = useState<Notificacion[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [abierta, setAbierta] = useState(false);
  const [permiso, setPermiso] = useState<
    NotificationPermission | "no_soportado"
  >("default");
  // Lo más reciente que ya se anunció en esta sesión (para no repetir sonido).
  const ultimoAnunciado = useRef<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/notificaciones", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: Notificacion[];
        noLeidas: number;
      };
      setItems(data.items);
      setNoLeidas(data.noLeidas);

      const masReciente = data.items[0]?.created_at ?? null;
      if (ultimoAnunciado.current === null) {
        // Primera carga: no anunciar lo viejo.
        ultimoAnunciado.current = masReciente ?? new Date().toISOString();
        return;
      }
      const nuevas = data.items.filter(
        (i) => i.created_at > (ultimoAnunciado.current ?? ""),
      );
      if (masReciente) ultimoAnunciado.current = masReciente;
      if (nuevas.length === 0) return;

      const urgente = nuevas.some((n) => URGENTES.has(n.tipo));
      if (urgente) sonar();
      const n = nuevas[0];
      toast(n.titulo, {
        description: n.cuerpo ?? undefined,
        action: n.enlace
          ? { label: "Abrir", onClick: () => router.push(n.enlace!) }
          : undefined,
      });
      if (
        urgente &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        const alerta = new Notification(n.titulo, {
          body: n.cuerpo ?? undefined,
          tag: n.id,
        });
        alerta.onclick = () => {
          window.focus();
          if (n.enlace) router.push(n.enlace);
        };
      }
    } catch {
      // Sin red: se reintenta en el siguiente intervalo.
    }
  }, [router]);

  useEffect(() => {
    // Primera carga en un callback (no síncrona dentro del efecto).
    const inicial = setTimeout(() => void cargar(), 0);
    const id = setInterval(() => void cargar(), INTERVALO_MS);
    const alVolver = () =>
      document.visibilityState === "visible" && void cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearTimeout(inicial);
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  async function marcarVistas() {
    setNoLeidas(0);
    try {
      await fetch("/api/notificaciones", { method: "POST" });
    } catch {
      // Se volverá a marcar la próxima vez.
    }
  }

  async function activarAlertas() {
    if (typeof Notification === "undefined") return;
    const r = await Notification.requestPermission();
    setPermiso(r);
    if (r === "granted") toast.success("Alertas del navegador activadas");
  }

  return (
    <Popover
      open={abierta}
      onOpenChange={(o) => {
        setAbierta(o);
        if (o) {
          // El permiso se lee al abrir: puede cambiar desde la configuración del navegador.
          setPermiso(
            typeof Notification === "undefined"
              ? "no_soportado"
              : Notification.permission,
          );
          if (noLeidas > 0) void marcarVistas();
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative text-muted-foreground hover:text-foreground"
          aria-label={noLeidas > 0 ? `Avisos: ${noLeidas} sin leer` : "Avisos"}
        >
          {noLeidas > 0 ? (
            <BellRing className="h-4 w-4 text-warning" aria-hidden="true" />
          ) : (
            <Bell className="h-4 w-4" aria-hidden="true" />
          )}
          {noLeidas > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground tabular-nums">
              {noLeidas > 9 ? "9+" : noLeidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[340px] max-w-[calc(100vw-24px)] p-0"
      >
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <p className="text-sm font-semibold">Avisos</p>
          {permiso === "default" && (
            <button
              type="button"
              onClick={() => void activarAlertas()}
              className="text-xs text-primary hover:underline"
            >
              Activar alertas del navegador
            </button>
          )}
          {permiso === "denied" && (
            <span className="text-[11px] text-muted-foreground">
              Alertas bloqueadas en el navegador
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Sin avisos por ahora.
          </p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto">
            {items.map((n) => {
              const { Icon, clase } = ICONO[n.tipo] ?? ICONO.handoff;
              const contenido = (
                <div className="flex gap-2.5 px-3 py-2.5 hover:bg-muted/50">
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      clase,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-snug">
                      {n.titulo}
                    </span>
                    {n.cuerpo && (
                      <span className="block text-xs text-muted-foreground line-clamp-2">
                        {n.cuerpo}
                      </span>
                    )}
                    <span className="block text-[11px] text-muted-foreground/80 mt-0.5">
                      {haceCuanto(n.created_at)}
                    </span>
                  </span>
                </div>
              );
              return (
                <li
                  key={n.id}
                  className="border-b border-border/30 last:border-b-0"
                >
                  {n.enlace ? (
                    <Link href={n.enlace} onClick={() => setAbierta(false)}>
                      {contenido}
                    </Link>
                  ) : (
                    contenido
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
