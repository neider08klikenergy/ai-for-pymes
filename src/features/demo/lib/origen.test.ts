import { test } from "node:test";
import assert from "node:assert/strict";
import { hashIp, ipDe } from "./origen.ts";

test("ipDe usa x-real-ip, luego el primer x-forwarded-for, y si no hay, un grupo común", () => {
  assert.equal(
    ipDe(
      new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }),
    ),
    "203.0.113.7",
  );
  assert.equal(
    ipDe(new Headers({ "x-forwarded-for": " 198.51.100.4 , 10.0.0.1" })),
    "198.51.100.4",
  );
  assert.equal(ipDe(new Headers()), "desconocida");
});

test("hashIp es estable por IP, distinto entre IPs y depende de la clave", () => {
  const k = "k".repeat(64);
  assert.equal(hashIp("203.0.113.7", k), hashIp("203.0.113.7", k));
  assert.notEqual(hashIp("203.0.113.7", k), hashIp("203.0.113.8", k));
  assert.notEqual(
    hashIp("203.0.113.7", k),
    hashIp("203.0.113.7", "otra".repeat(16)),
  );
  assert.match(hashIp("203.0.113.7", k), /^[0-9a-f]{64}$/);
});
