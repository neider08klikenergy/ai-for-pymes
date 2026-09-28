import assert from "node:assert/strict";
import { test } from "node:test";
import { siguienteEstado, transicionPermitida } from "./estados";
import { esFechaValida, hoyEnZona, rangoDelDia, sumarDias } from "./fechas";

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
