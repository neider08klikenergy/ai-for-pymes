import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OUTBOUND_IMAGE_MAX_BYTES,
  outboundImagePath,
  validateOutboundImage,
} from "./outbound-image.ts";

test("acepta JPG y PNG dentro del tope", () => {
  assert.equal(validateOutboundImage({ type: "image/jpeg", size: 1000 }), null);
  assert.equal(validateOutboundImage({ type: "image/png", size: OUTBOUND_IMAGE_MAX_BYTES }), null);
});

test("rechaza otros formatos, archivos vacíos y los que pasan el tope", () => {
  assert.match(validateOutboundImage({ type: "image/webp", size: 10 }) ?? "", /JPG o PNG/);
  assert.match(validateOutboundImage({ type: "application/pdf", size: 10 }) ?? "", /JPG o PNG/);
  assert.match(validateOutboundImage({ type: "image/jpeg", size: 0 }) ?? "", /vacía/);
  assert.match(
    validateOutboundImage({ type: "image/jpeg", size: OUTBOUND_IMAGE_MAX_BYTES + 1 }) ?? "",
    /4 MB/,
  );
});

test("la ruta tiene la forma que acepta /api/inbox/media-url", () => {
  const ws = "11111111-1111-4111-8111-111111111111";
  const conv = "22222222-2222-4222-8222-222222222222";
  const id = "33333333-3333-4333-8333-333333333333";
  assert.equal(outboundImagePath(ws, conv, "image/png", id), `${ws}/${conv}/out-${id}.png`);
  assert.equal(outboundImagePath(ws, conv, "image/jpeg", id), `${ws}/${conv}/out-${id}.jpg`);
  const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  assert.match(outboundImagePath(ws, conv, "image/jpeg", id), new RegExp(`^(${UUID})/(${UUID})/[A-Za-z0-9._-]+$`));
});
