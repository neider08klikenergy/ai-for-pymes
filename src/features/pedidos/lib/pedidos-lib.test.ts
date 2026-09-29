import assert from "node:assert/strict";
import { test } from "node:test";
import { siguienteEstado, transicionPermitida } from "./estados";
import {
  esFechaValida,
  hoyEnZona,
  rangoDelDia,
  semanasDelMes,
  sumarDias,
  sumarMeses,
} from "./fechas";
import { leerFiltros, urlPedidos } from "./filtros";
import {
  mensajePagoConfirmado,
  mensajePagoRechazado,
  mensajePedidoCancelado,
  mensajePedidoListo,
} from "./mensajes";

test("producción avanza en orden y no salta pasos", () => {
  assert.equal(siguienteEstado("confirmado"), "en_produccion");
  assert.equal(siguienteEstado("listo"), "entregado");
  assert.equal(siguienteEstado("pendiente_anticipo"), null);
  assert.ok(transicionPermitida("en_produccion", "listo"));
  assert.ok(!transicionPermitida("confirmado", "entregado"));
  // El pago lo confirma pd_confirmar_pago, no el botón de estado
  assert.ok(!transicionPermitida("por_verificar", "confirmado"));
});

test("cancelar se permite salvo entregado o ya cancelado", () => {
  assert.ok(transicionPermitida("pendiente_anticipo", "cancelado"));
  assert.ok(transicionPermitida("listo", "cancelado"));
  assert.ok(!transicionPermitida("entregado", "cancelado"));
  assert.ok(!transicionPermitida("cancelado", "cancelado"));
});

test("el día de Bogotá va de 05:00Z a 05:00Z del día siguiente", () => {
  assert.deepEqual(rangoDelDia("2026-10-02", "America/Bogota"), {
    desde: "2026-10-02T05:00:00.000Z",
    hasta: "2026-10-03T05:00:00.000Z",
  });
});

test("hoy en Bogotá a las 23:30 locales sigue siendo el mismo día", () => {
  // 2026-10-02 23:30 en Bogotá = 2026-10-03 04:30Z
  assert.equal(hoyEnZona("America/Bogota", new Date("2026-10-03T04:30:00Z")), "2026-10-02");
});

test("fechas: validación y suma de días", () => {
  assert.ok(esFechaValida("2026-02-28"));
  assert.ok(!esFechaValida("2026-02-30"));
  assert.ok(!esFechaValida("mañana"));
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
});

// ── Mensajes al cliente ──────────────────────────────────────────────────────

const datos = {
  numero: "GOL-00001",
  nombre_cliente: "Neider Urbano",
  fecha_entrega: "2026-10-01T20:00:00Z", // 3:00 p. m. en Bogotá
  sede_nombre: "Golosita Caudal (Grama)",
  modalidad: "recogida" as const,
  total: 150000,
  pagado: 0,
};

test("pago confirmado: número, fecha local, sede y saldo que queda", () => {
  const m = mensajePagoConfirmado(datos, 90000, "America/Bogota");
  assert.match(m, /Neider!/);
  assert.match(m, /GOL-00001/);
  assert.match(m, /3:00/);
  assert.match(m, /Caudal/);
  assert.match(m, /60\.000/);
  assert.doesNotMatch(m, /Urbano/);
});

test("pago confirmado por el total: no menciona saldo pendiente", () => {
  const m = mensajePagoConfirmado(datos, 150000, "America/Bogota");
  assert.match(m, /pagado en su totalidad/);
});

test("rechazo, listo y cancelación", () => {
  assert.match(mensajePagoRechazado(datos, "no aparece en la cuenta."), /: no aparece en la cuenta\./);
  assert.match(mensajePedidoListo({ ...datos, pagado: 90000 }), /listo para recoger en Golosita Caudal[\s\S]*60\.000/);
  assert.match(mensajePedidoListo({ ...datos, modalidad: "domicilio" }), /sale hacia tu dirección/);
  assert.match(mensajePedidoCancelado({ ...datos, pagado: 90000 }), /saldo a favor por 6 meses/);
  assert.doesNotMatch(mensajePedidoCancelado(datos), /saldo a favor/);
});

// ── Filtros y calendario ─────────────────────────────────────────────────────

test("filtros por defecto: tabla, activos, de hoy a 30 días", () => {
  const f = leerFiltros({}, "2026-09-28");
  assert.equal(f.vista, "tabla");
  assert.equal(f.estado, "activos");
  assert.equal(f.desde, "2026-09-28");
  assert.equal(f.hasta, "2026-10-28");
  assert.equal(f.mes, "2026-09");
  assert.equal(urlPedidos(f, "2026-09-28"), "/pedidos");
});

test("filtros inválidos se ignoran y el rango se ordena", () => {
  const f = leerFiltros(
    { vista: "x", estado: "borrado", desde: "2026-10-10", hasta: "2026-10-01", mes: "2026-13", dia: "ayer" },
    "2026-09-28",
  );
  assert.equal(f.vista, "tabla");
  assert.equal(f.estado, "activos");
  assert.deepEqual([f.desde, f.hasta], ["2026-10-01", "2026-10-10"]);
  assert.equal(f.mes, "2026-09");
  assert.equal(f.dia, null);
});

test("la URL conserva solo lo que cambió", () => {
  const f = leerFiltros({ vista: "calendario", mes: "2026-10", dia: "2026-10-01", sede: "caudal" }, "2026-09-28");
  assert.equal(urlPedidos(f, "2026-09-28"), "/pedidos?vista=calendario&mes=2026-10&dia=2026-10-01&sede=caudal");
});

test("calendario de octubre 2026: arranca el lunes 28 sep y cubre todo el mes", () => {
  const s = semanasDelMes("2026-10");
  assert.equal(s[0][0], "2026-09-28");
  assert.equal(s.at(-1)!.at(-1), "2026-11-01");
  assert.ok(s.every((w) => w.length === 7));
  assert.equal(sumarMeses("2026-12", 1), "2027-01");
});
