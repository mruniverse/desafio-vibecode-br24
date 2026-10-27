import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PortaBitrix } from "../src/lib/ausencias/portas.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-sync-pos-commit-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";

const { getDb } = await import("../src/lib/db/index.ts");
const { PORTAL_DEMO, semearDemo } = await import("../src/lib/ausencias/seed.ts");
const { criarServicosAusencias } = await import("../src/lib/ausencias/servicos-impl.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");

const porta: PortaBitrix = {
  async buscarEvento() { return null; },
  async criarEvento() { throw new Error("a fila deveria falhar antes da chamada ao Bitrix"); },
  async removerEvento() {},
  async calendarioTrabalho() { return { diasNaoUteis: ["SA", "SU"], feriados: [], excecoesTrabalhadas: [] }; },
  async notificar() {},
};

after(() => {
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("falha real do SQLite ao tomar job apos commit preserva decisao e retorna sucesso", async () => {
  semearDemo({ hoje: "2026-10-26" });
  const sv = criarServicosAusencias({
    portalMemberId: PORTAL_DEMO,
    relogio: { hoje: () => "2026-10-26", agora: () => "2026-10-26T12:00:00.000Z" },
    porta,
  });
  await sv.aquecerCalendario();
  const criado = await sv.solicitar({ pessoaId: "ana", papel: "colaborador" }, {
    tipoId: "outro", inicio: "2027-01-11", fim: "2027-01-12",
  });
  // A transacao da decisao insere job pendente; o trigger aborta somente a
  // transicao posterior para em_andamento, fora do executor e de seus catches.
  getDb().exec(`CREATE TRIGGER falhar_tomada_sync BEFORE UPDATE OF estado ON sync_job
    WHEN NEW.estado = 'em_andamento'
    BEGIN SELECT RAISE(ABORT, 'falha sqlite na sincronizacao'); END`);
  const aprovado = await sv.decidir({ pessoaId: "carlos", papel: "gestor" }, criado.id, {
    decisao: "aprovar", versao: criado.versao,
  });
  assert.equal(aprovado.status, "aprovada");
  assert.equal(repo.lerPedidoInterno(PORTAL_DEMO, criado.id)?.status, "aprovada");
  assert.equal(repo.obterJobDoPedido(PORTAL_DEMO, criado.id, "adicionar")?.estado, "pendente");
});
