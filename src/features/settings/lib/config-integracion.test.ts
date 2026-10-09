import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAVES_CONFIG, configPermitida } from "./config-integracion.ts";

test("Zernio nunca acepta su perfil ni sus cuentas desde el cuerpo", () => {
  const r = configPermitida("zernio", {
    profile_id: "p_otro",
    accounts: [{ id: "acc" }],
    account_ids: ["acc"],
    cost_cut_handoff: true,
  });
  assert.deepEqual(r.config, { cost_cut_handoff: true });
  assert.deepEqual(r.ignoradas.sort(), [
    "account_ids",
    "accounts",
    "profile_id",
  ]);
  for (const clave of ["profile_id", "accounts", "account_ids"]) {
    assert.ok(!CLAVES_CONFIG.zernio.includes(clave));
  }
});

test("cada proveedor solo acepta sus claves", () => {
  assert.deepEqual(
    configPermitida("shopify", {
      shop_domain: "x.myshopify.com",
      location_id: "l",
    }).config,
    {
      shop_domain: "x.myshopify.com",
    },
  );
  assert.deepEqual(
    configPermitida("openrouter", { default_model: "m", phone_number: "+57" })
      .config,
    {
      default_model: "m",
    },
  );
});

test("valores: texto corto, número finito, sí/no o null", () => {
  const r = configPermitida("ycloud", {
    phone_number: "+573001112233",
    buffer_silence_seconds: Number.NaN,
    handoff_ack_enabled: false,
    handoff_ack_message: null,
    message_history_window: ["no"],
  });
  assert.deepEqual(r.config, {
    phone_number: "+573001112233",
    handoff_ack_enabled: false,
    handoff_ack_message: null,
  });
});
