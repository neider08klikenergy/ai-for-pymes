import assert from "node:assert/strict";
import { test } from "node:test";
import { CuentaSchema, SedeSchema, TarifaSchema, describirCuenta } from "./ajustes.ts";

const uuid = "5b0f8a52-4a0b-4d3c-9a57-1d2f3e4a5b6c";

test("cuenta: textos vacíos quedan en null y el número se valida", () => {
  const ok = CuentaSchema.parse({
    id: null,
    sede_id: null,
    tipo: "ahorros",
    banco: " Bancolombia ",
    numero: "84400002267",
    titular: "",
    documento: "  ",
    activa: true,
    orden: "2",
  });
  assert.equal(ok.banco, "Bancolombia");
  assert.equal(ok.titular, null);
  assert.equal(ok.documento, null);
  assert.equal(ok.orden, 2);
  assert.equal(
    CuentaSchema.safeParse({ ...ok, numero: "12<script>" }).success,
    false,
    "rechaza caracteres raros en el número",
  );
  assert.equal(CuentaSchema.safeParse({ ...ok, tipo: "cripto" }).success, false);
});

test("tarifa: zona vacía = tarifa plana; valor no negativo", () => {
  const plana = TarifaSchema.parse({ sede_id: null, zona: "", valor: 8000, activa: true });
  assert.equal(plana.zona, null);
  assert.equal(TarifaSchema.safeParse({ sede_id: null, zona: "Barzal", valor: -1, activa: true }).success, false);
  assert.equal(TarifaSchema.safeParse({ sede_id: "no-uuid", zona: null, valor: 1, activa: true }).success, false);
});

test("sede: exige nombre y cupo entero no negativo; ignora el código", () => {
  const s = SedeSchema.parse({
    id: uuid,
    codigo: "caudal",
    nombre: "Caudal",
    direccion: "",
    telefono: null,
    cupo_diario: 10,
    acepta_personalizados: true,
    activa: true,
  });
  assert.equal("codigo" in s, false);
  assert.equal(s.direccion, null);
  assert.equal(SedeSchema.safeParse({ ...s, cupo_diario: -2 }).success, false);
});

test("describirCuenta arma el texto igual que pd_datos_pago", () => {
  assert.equal(describirCuenta({ tipo: "ahorros", banco: "Davivienda", numero: "0984" }), "Davivienda, cuenta de ahorros 0984");
  assert.equal(describirCuenta({ tipo: "llave", banco: "Bre-B", numero: "0029" }), "Llave Bre-B 0029");
  assert.equal(describirCuenta({ tipo: "billetera", banco: "Nequi", numero: "300" }), "Nequi 300");
});
