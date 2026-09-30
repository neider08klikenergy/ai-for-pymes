import assert from "node:assert/strict";
import { test } from "node:test";
import { conDomicilio } from "./cotizar-producto.ts";

test("conDomicilio suma el domicilio al total; el anticipo sigue siendo del producto", () => {
  const out = conDomicilio({ ok: true, total: 150000, anticipo: 90000, saldo: 60000 }, 8000) as Record<string, unknown>;
  assert.equal(out.total_con_domicilio, 158000);
  assert.deepEqual(out.formas_de_pago, { todo: 158000, solo_producto: 150000, anticipo_minimo: 90000 });
  assert.equal(out.saldo_si_paga_anticipo, 68000);
  assert.equal(out.saldo_si_paga_producto, 8000);
});

test("conDomicilio no toca una salida sin total", () => {
  const raro = { ok: false, error: "PRECIO_NO_ENCONTRADO" };
  assert.equal(conDomicilio(raro, 8000), raro);
});
