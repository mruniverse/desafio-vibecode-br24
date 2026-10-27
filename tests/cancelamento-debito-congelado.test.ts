import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CalendarioTrabalho, Relogio } from "../src/lib/ausencias/tipos.ts";
import type { PortaBitrix } from "../src/lib/ausencias/portas.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-cancelamento-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";
const { getDb } = await import("../src/lib/db/index.ts");
const { PORTAL_DEMO, semearDemo } = await import("../src/lib/ausencias/seed.ts");
const { criarServicosAusencias } = await import("../src/lib/ausencias/servicos-impl.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");

after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("cancelamento limita debito passado ao congelado por ano mesmo com mudanca de calendario", async () => {
  semearDemo({ hoje: "2026-12-01" });
  let feriados = ["12-29", "12-30", "12-31", "01-04", "01-05", "01-07", "01-08"];
  const porta: PortaBitrix = {
    async calendarioTrabalho(): Promise<CalendarioTrabalho> { return { diasNaoUteis: ["SA", "SU"], feriados, excecoesTrabalhadas: [] }; },
    async buscarEvento() { return null; },
    async criarEvento() { return { id: "fake" }; },
    async removerEvento() {},
    async notificar() {},
  };
  function servicos(hoje: string) {
    const relogio: Relogio = { hoje: () => hoje, agora: () => `${hoje}T12:00:00.000Z` };
    return criarServicosAusencias({ portalMemberId: PORTAL_DEMO, relogio, porta });
  }
  const antes = servicos("2026-12-01");
  const pedido = await antes.solicitar({ pessoaId: "ana", papel: "colaborador" }, { tipoId: "ferias", inicio: "2026-12-28", fim: "2027-01-08", justificativa: "Preciso destes dias adicionais" });
  await antes.decidir({ pessoaId: "carlos", papel: "gestor" }, pedido.id, { decisao: "aprovar", versao: pedido.versao });
  assert.deepEqual(repo.lerPedidoInterno(PORTAL_DEMO, pedido.id)?.diasDebitoPorAno, { "2026": 1, "2027": 2 });

  feriados = [];
  await servicos("2027-01-06").cancelar({ pessoaId: "carlos", papel: "gestor" }, pedido.id);
  const cancelado = repo.lerPedidoInterno(PORTAL_DEMO, pedido.id);
  assert.equal(cancelado?.status, "cancelada");
  assert.deepEqual(cancelado?.diasDebitoPorAno, { "2026": 1, "2027": 2 });
});

test("pedido com saldo de outra competencia exige justificativa e aceita excedente justificado", async () => {
  semearDemo({ hoje: "2026-10-26" });
  const db = getDb();
  db.prepare("DELETE FROM lancamento WHERE portal_member_id = ? AND pessoa_id = 'ana' AND carteira = 'folga'").run(PORTAL_DEMO);
  db.prepare(`INSERT INTO lancamento (portal_member_id, pessoa_id, ano, carteira, tipo, dias, motivo, criado_por, criado_em, origem)
    VALUES (?, 'ana', 2027, 'folga', 'credito', 5, 'Crédito futuro', 'marina', '2026-10-26T12:00:00.000Z', 'app')`).run(PORTAL_DEMO);
  const { FakeBitrix } = await import("../src/lib/bitrix/ausencias/fake.ts");
  const sv = criarServicosAusencias({ portalMemberId: PORTAL_DEMO, relogio: { hoje: () => "2026-10-26", agora: () => "2026-10-26T12:00:00.000Z" }, porta: new FakeBitrix() });
  const sessao = { pessoaId: "ana", papel: "colaborador" as const };
  const entrada = { tipoId: "folga", inicio: "2026-11-03", fim: "2026-11-06" };
  await assert.rejects(sv.solicitar(sessao, entrada), (e: unknown) => {
    assert.ok(e && typeof e === "object" && "issues" in e);
    assert.ok(Array.isArray(e.issues) && e.issues.some((i: { path: unknown[] }) => i.path[0] === "justificativa"));
    return true;
  });
  const pedido = await sv.solicitar(sessao, { ...entrada, justificativa: "Preciso destes dias adicionais" });
  assert.equal(pedido.excedeSaldo, true);
});
