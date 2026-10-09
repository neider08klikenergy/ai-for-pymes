import {
  motivoHandoff,
  evaluarSeguimiento,
  leerConfigSeguimiento,
  type MensajeSeguimiento,
  repartirPorWorkspace,
} from "./seguimiento";
import { test } from "node:test";
import assert from "node:assert/strict";

const ahora = new Date("2026-09-29T20:00:00Z");
const hace = (min: number) =>
  new Date(ahora.getTime() - min * 60_000).toISOString();
let n = 0;
function m(
  p: Partial<MensajeSeguimiento> & { direction: "in" | "out"; min: number },
): MensajeSeguimiento {
  return {
    id: `m${++n}`,
    type: "text",
    sender_user_id: null,
    meta: {},
    created_at: hace(p.min),
    ...p,
  };
}
const base = {
  handoffDesde: null,
  yaRecordado: false,
  ventanaAbierta: true,
  minutos: 8,
  ahora,
};

test("configuración: 8 min por defecto, activa, y valores inválidos se ignoran", () => {
  assert.deepEqual(leerConfigSeguimiento(null), { activo: true, minutos: 8 });
  assert.deepEqual(
    leerConfigSeguimiento({ seguimiento_humano: { minutos: 5 } }),
    { activo: true, minutos: 5 },
  );
  assert.deepEqual(
    leerConfigSeguimiento({
      seguimiento_humano: { activo: false, minutos: -3 },
    }),
    {
      activo: false,
      minutos: 8,
    },
  );
});

test("humano: cliente sin respuesta 8 min → la IA retoma con TODO lo pendiente", () => {
  const msgs = [
    m({ direction: "out", sender_user_id: "u1", min: 30 }), // respondió el equipo
    m({ direction: "in", min: 10 }),
    m({ direction: "in", min: 9 }),
  ];
  const r = evaluarSeguimiento({
    ...base,
    estado: "human_active",
    mensajes: msgs,
  });
  assert.equal(r.tipo, "retomar_ia");
  assert.deepEqual(r.tipo === "retomar_ia" && r.pendientes, [
    msgs[1].id,
    msgs[2].id,
  ]);
});

test("humano: todavía no pasan 8 min → nada", () => {
  const msgs = [
    m({ direction: "out", sender_user_id: "u1", min: 30 }),
    m({ direction: "in", min: 7 }),
  ];
  assert.equal(
    evaluarSeguimiento({ ...base, estado: "human_active", mensajes: msgs })
      .tipo,
    "nada",
  );
});

test("humano: el equipo respondió desde el celular (coexistencia) → nada", () => {
  const msgs = [
    m({ direction: "in", min: 20 }),
    m({ direction: "out", meta: { origin: "business_app" }, min: 15 }),
  ];
  assert.equal(
    evaluarSeguimiento({ ...base, estado: "human_active", mensajes: msgs })
      .tipo,
    "nada",
  );
});

test("humano: las notas internas no cuentan como respuesta", () => {
  const msgs = [
    m({ direction: "in", min: 20 }),
    m({ direction: "out", type: "system", meta: { internal: true }, min: 15 }),
  ];
  assert.equal(
    evaluarSeguimiento({ ...base, estado: "human_active", mensajes: msgs })
      .tipo,
    "retomar_ia",
  );
});

test("humano: ventana de 24 h cerrada → nada (la IA no podría responder)", () => {
  const msgs = [m({ direction: "in", min: 20 })];
  assert.equal(
    evaluarSeguimiento({
      ...base,
      ventanaAbierta: false,
      estado: "human_active",
      mensajes: msgs,
    }).tipo,
    "nada",
  );
});

test("traspaso (handoff): nunca vuelve a la IA; a los 8 min recuerda una sola vez", () => {
  const msgs = [
    m({ direction: "in", min: 12 }),
    m({ direction: "out", min: 12 }), // aviso automático "ya te atiende una persona" (IA)
  ];
  const r = evaluarSeguimiento({
    ...base,
    estado: "handoff_pending",
    handoffDesde: hace(12),
    mensajes: msgs,
  });
  assert.equal(r.tipo, "recordar_handoff");
  assert.equal(
    evaluarSeguimiento({
      ...base,
      estado: "handoff_pending",
      handoffDesde: hace(12),
      yaRecordado: true,
      mensajes: msgs,
    }).tipo,
    "nada",
  );
});

test("traspaso: si una persona ya respondió → nada", () => {
  const msgs = [
    m({ direction: "in", min: 12 }),
    m({ direction: "out", sender_user_id: "u1", min: 5 }),
  ];
  assert.equal(
    evaluarSeguimiento({
      ...base,
      estado: "handoff_pending",
      handoffDesde: hace(12),
      mensajes: msgs,
    }).tipo,
    "nada",
  );
});

test("IA activa o cerrada → nada", () => {
  const msgs = [m({ direction: "in", min: 60 })];
  assert.equal(
    evaluarSeguimiento({ ...base, estado: "ai_active", mensajes: msgs }).tipo,
    "nada",
  );
  assert.equal(
    evaluarSeguimiento({ ...base, estado: "closed", mensajes: msgs }).tipo,
    "nada",
  );
});

test("motivos del traspaso en español", () => {
  assert.match(motivoHandoff("keyword"), /pidió hablar con una persona/);
  assert.match(motivoHandoff("otro"), /necesita una persona/);
});

test("repartirPorWorkspace: un workspace con muchas conversaciones no deja sin turno a los demás", () => {
  const grande = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, workspace_id: "A" }));
  const chico = [{ id: "b0", workspace_id: "B" }];
  const elegidas = repartirPorWorkspace([...grande, ...chico], 10, 60);
  assert.ok(elegidas.some((c) => c.id === "b0"), "la del workspace B entra aunque A tenga 40");
  assert.equal(elegidas.filter((c) => c.workspace_id === "A").length, 10, "A queda en su máximo por workspace");
});

test("repartirPorWorkspace: respeta el total y el orden dentro de cada workspace", () => {
  const cands = ["A", "B", "C"].flatMap((w) =>
    Array.from({ length: 5 }, (_, i) => ({ id: `${w}${i}`, workspace_id: w })),
  );
  const elegidas = repartirPorWorkspace(cands, 10, 7);
  assert.equal(elegidas.length, 7);
  assert.deepEqual(elegidas.slice(0, 3).map((c) => c.id), ["A0", "B0", "C0"]);
  assert.deepEqual(elegidas.filter((c) => c.workspace_id === "A").map((c) => c.id), ["A0", "A1", "A2"]);
});
