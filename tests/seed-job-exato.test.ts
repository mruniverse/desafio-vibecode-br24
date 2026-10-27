import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-seed-job-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";
const { getDb } = await import("../src/lib/db/index.ts");
const { PORTAL_DEMO, semearDemo } = await import("../src/lib/ausencias/seed.ts");
const { semearPedidosDemo } = await import("../src/lib/ausencias/seed-demo-pedidos.ts");
const { criarServicosAusencias } = await import("../src/lib/ausencias/servicos-impl.ts");
const { FakeBitrix } = await import("../src/lib/bitrix/ausencias/fake.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");

after(() => {
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("seed de pedidos nao conclui o job de OUTRO pedido ja enfileirado", async () => {
  const hoje = "2026-10-26";
  semearDemo({ hoje });
  const relogio = { hoje: () => hoje, agora: () => `${hoje}T12:00:00.000Z` };
  const sv = criarServicosAusencias({ portalMemberId: PORTAL_DEMO, relogio, porta: new FakeBitrix() });

  // Pedido real aprovado ANTES do seed, com o job `adicionar` ainda na fila (sem rodar a sincronizacao).
  const alheio = await sv.solicitar(
    { pessoaId: "bruno", papel: "colaborador" },
    { tipoId: "ferias", inicio: "2027-06-07", fim: "2027-06-11" },
  );
  repo.decidirPedido(PORTAL_DEMO, {
    pedidoId: alheio.id,
    versao: alheio.versao,
    decisao: "aprovar",
    decididoPor: "carlos",
    decididoEm: `${hoje}T13:00:00.000Z`,
  });
  const jobAlheioAntes = repo.obterJobDoPedido(PORTAL_DEMO, alheio.id, "adicionar");
  assert.equal(jobAlheioAntes?.estado, "pendente");

  const r = semearPedidosDemo({ hoje });
  assert.equal(r.executado, true);

  // O job do pedido alheio continua intacto: nao ganhou lease, tentativa nem evento "demo-*".
  const jobAlheio = repo.obterJobDoPedido(PORTAL_DEMO, alheio.id, "adicionar");
  assert.equal(jobAlheio?.estado, "pendente", "o seed nao pode tomar o job de outro pedido");
  assert.equal(jobAlheio?.tentativas, 0);
  const pedidoAlheio = repo.lerPedidoInterno(PORTAL_DEMO, alheio.id);
  assert.equal(pedidoAlheio?.bitrixEventId ?? null, null);

  // Cada pedido aprovado do seed tem o proprio evento demo-<id> no proprio job.
  const db = getDb();
  const semeados = db
    .prepare("SELECT id, sincronizacao, bitrix_event_id AS ev FROM pedido WHERE portal_member_id = ? AND origem = 'seed' AND status = 'aprovada'")
    .all(PORTAL_DEMO) as { id: number; sincronizacao: string; ev: string | null }[];
  assert.ok(semeados.length > 0);
  for (const p of semeados) {
    if (p.sincronizacao === "ok") assert.equal(p.ev, `demo-${p.id}`);
  }
});
