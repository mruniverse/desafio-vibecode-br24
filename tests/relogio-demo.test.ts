import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";
const { criarRelogioDemo } = await import("../src/lib/ausencias/boot.ts");

test("relogio da demo: `hoje` fixo e `agora` nunca volta, nem na virada do dia UTC", () => {
  let real = Date.parse("2026-10-27T23:59:50.000Z");
  const r = criarRelogioDemo("2026-10-26", () => real);
  assert.equal(r.hoje(), "2026-10-26");
  const antes = r.agora();
  assert.equal(antes.slice(0, 10), "2026-10-26", "comeca no dia da demonstracao");
  real += 20_000; // atravessa a meia-noite UTC
  const depois = r.agora();
  assert.ok(Date.parse(depois) > Date.parse(antes), `agora voltou: ${antes} -> ${depois}`);
  assert.equal(r.hoje(), "2026-10-26", "a data da demonstracao continua fixa");
});

test("relogio da demo: um lease de 1h acaba expirando (o tempo avanca)", () => {
  let real = Date.parse("2026-10-27T10:00:00.000Z");
  const r = criarRelogioDemo("2026-10-26", () => real);
  const leaseAte = new Date(Date.parse(r.agora()) + 3_600_000).toISOString();
  real += 3_700_000;
  assert.ok(r.agora() > leaseAte);
});
