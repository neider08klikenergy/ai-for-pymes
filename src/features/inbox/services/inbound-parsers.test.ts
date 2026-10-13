import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInbound as parseKapso } from "./kapso-webhook-handler.ts";

function kapso(message: Record<string, unknown>) {
  return parseKapso(
    {
      phone_number_id: "pn_1",
      message: { id: "wamid.k-1", from: "15550000001", timestamp: "1759000000", ...message },
    },
    "whatsapp.message.received",
  );
}

test("Kapso: a location keeps its enum type and reads as a place", () => {
  const loc = kapso({ type: "location", location: { name: "Clínica", address: "Av. 5" } });
  assert.equal(loc?.type, "location");
  assert.equal(loc?.text, "[Ubicación compartida: Clínica, Av. 5]");
});

test("Kapso: button and interactive replies read the same way", () => {
  assert.equal(kapso({ type: "button", button: { text: "Sí" } })?.text, "Sí");
  assert.equal(
    kapso({
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "x", title: "Agendar" } },
    })?.text,
    "Agendar",
  );
  assert.equal(
    kapso({ type: "order", order: { text: "2 pasteles" } })?.text,
    "[Pedido del catálogo]: 2 pasteles",
  );
});
