"use client";

import {
  FileImage,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { abrirComprobante } from "./comun";
import { Button } from "@/components/ui/button";
import type { PagoPorVerificar } from "../types";
import { useLocale, useTranslations } from "next-intl";
import { fechaCorta, horaLocal, pesos } from "../lib/fechas";

function PagoCard({
  pago,
  zona,
  puedeActuar,
  onRevisar,
}: {
  pago: PagoPorVerificar;
  zona: string;
  puedeActuar: boolean;
  onRevisar: (pago: PagoPorVerificar, aprobar: boolean) => void;
}) {
  const montoNoCoincide =
    pago.monto_reportado !== null && pago.monto_reportado < pago.monto_esperado;
  const t = useTranslations("pedidos.pagos");
  const idioma = useLocale();

  return (
    <li className="min-w-0 rounded-xl border border-warning/30 bg-warning/5 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold">
            {pago.pedido?.numero ?? t("pedido")}{" "}
            <span className="font-sans font-normal text-muted-foreground">
              ·{" "}
              {t.has(`tipo.${pago.tipo}`)
                ? t(`tipo.${pago.tipo}` as "tipo.anticipo")
                : pago.tipo}
            </span>
          </p>
          <p className="text-sm truncate">{pago.pedido?.nombre_cliente}</p>
          {pago.pedido && (
            <p className="text-xs text-muted-foreground">
              {t("entrega")}{" "}
              {fechaCorta(pago.pedido.fecha_entrega, zona, idioma)}{" "}
              {horaLocal(pago.pedido.fecha_entrega, zona, idioma)}
              {pago.pedido.sede_nombre ? ` · ${pago.pedido.sede_nombre}` : ""}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {t("recibido")} {fechaCorta(pago.created_at, zona, idioma)}{" "}
            {horaLocal(pago.created_at, zona, idioma)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{t("esperado")}</p>
          <p className="font-display text-lg font-semibold tabular-nums">
            {pesos(pago.monto_esperado)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("montoComprobante")}</dt>
        <dd
          className={cn(
            "tabular-nums",
            montoNoCoincide && "text-destructive font-semibold",
          )}
        >
          {pago.monto_reportado !== null ? pesos(pago.monto_reportado) : "—"}
        </dd>
        <dt className="text-muted-foreground">{t("banco")}</dt>
        <dd>{pago.banco ?? "—"}</dd>
        <dt className="text-muted-foreground">{t("referencia")}</dt>
        <dd className="font-mono break-all">{pago.referencia ?? "—"}</dd>
        <dt className="text-muted-foreground">{t("fechaPago")}</dt>
        <dd>{pago.fecha_pago ?? "—"}</dd>
      </dl>

      {montoNoCoincide && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {t("montoMenor")}
        </p>
      )}

      {pago.descripcion_ia && (
        <p
          className="text-xs text-muted-foreground line-clamp-3"
          title={pago.descripcion_ia}
        >
          <span className="font-medium">{t("leyoIa")}</span>{" "}
          {pago.descripcion_ia}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {pago.storage_path ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              abrirComprobante(pago.storage_path!, t("errorComprobante"))
            }
          >
            <FileImage className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {t("verComprobante")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("sinArchivo")}
          </span>
        )}
        {pago.pedido?.conversation_id && (
          <Link href={`/inbox/${pago.pedido.conversation_id}`}>
            <Button variant="ghost" size="sm">
              <MessageCircle className="h-4 w-4 mr-1.5" aria-hidden="true" />
              {t("chat")}
            </Button>
          </Link>
        )}
        {puedeActuar && (
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRevisar(pago, false)}
            >
              {t("rechazar")}
            </Button>
            <Button size="sm" onClick={() => onRevisar(pago, true)}>
              {t("confirmar")}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function PagosLista({
  pagos,
  zona,
  puedeActuar,
  onRevisar,
}: {
  pagos: PagoPorVerificar[];
  zona: string;
  puedeActuar: boolean;
  onRevisar: (pago: PagoPorVerificar, aprobar: boolean) => void;
}) {
  const t = useTranslations("pedidos.pagos");
  if (pagos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
        <CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" />
        <p className="text-sm font-medium">{t("vacioTitulo")}</p>
        <p className="text-xs text-muted-foreground">{t("vacioTexto")}</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {pagos.map((p) => (
        <PagoCard
          key={p.id}
          pago={p}
          zona={zona}
          puedeActuar={puedeActuar}
          onRevisar={onRevisar}
        />
      ))}
    </ul>
  );
}
