import assert from "node:assert/strict";
import { test } from "node:test";
import { motivoDePasarAPersona, pasarAPersonaTool } from "./pasar-a-persona.ts";

const ctx = { workspaceId: "ws_1", conversationId: "conv_1", contactId: "c_1" };

test("pasar_a_persona devuelve el motivo limpio y no toca la base", async () => {
  const r = await pasarAPersonaTool.run({ motivo: "  Cotizar domicilio a Barzal  " }, ctx);
  assert.equal(r.ok, true);
  assert.equal(motivoDePasarAPersona(r.output), "Cotizar domicilio a Barzal");
});

test("motivoDePasarAPersona ignora salidas sin motivo", () => {
  assert.equal(motivoDePasarAPersona(null), null);
  assert.equal(motivoDePasarAPersona({ motivo: "   " }), null);
  assert.equal(motivoDePasarAPersona("texto"), null);
  assert.equal(motivoDePasarAPersona({ motivo: "x".repeat(400) })?.length, 300);
});

test("el esquema exige un motivo", () => {
  assert.equal(pasarAPersonaTool.schema.safeParse({}).success, false);
  assert.equal(pasarAPersonaTool.schema.safeParse({ motivo: "Cotizar domicilio" }).success, true);
});
