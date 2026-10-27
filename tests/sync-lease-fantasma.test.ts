/** Lease vencido nao significa que a escrita remota terminou. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { PortaBitrix, EventoCalendarioBitrix } from "../src/lib/ausencias/portas.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-lease-fantasma-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";
const { getDb } = await import("../src/lib/db/index.ts");
const { semearDemo, PORTAL_DEMO: m } = await import("../src/lib/ausencias/seed.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");
const { FakeBitrix } = await import("../src/lib/bitrix/ausencias/fake.ts");
const { executarSincronizacao } = await import("../src/lib/bitrix/ausencias/executor.ts");

after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("criacao atrasada bloqueia remocao ate poder ser compensada, mesmo apos lease expirar", async () => {
  semearDemo({ hoje: "2026-10-26" });
  const agora = "2026-10-26T12:00:00.000Z";
  const depois = "2026-10-26T14:00:00.000Z";
  const p = repo.criarPedido(m, {
    pessoaId: "ana", tipoId: "outro", inicio: "2027-01-11", fim: "2027-01-12",
    diasUteis: 2, diasDebitoPorAno: { "2027": 2 }, diasOcupados: ["2027-01-11", "2027-01-12"],
    excedeSaldo: false, criadoEm: agora,
  });
  repo.decidirPedido(m, { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: agora });
  const add = repo.tomarProximoJob(m, agora, "2026-10-26T13:00:00.000Z");
  assert.equal(add?.operacao, "adicionar");

  const fake = new FakeBitrix();
  let liberar!: () => void;
  let iniciou!: () => void;
  const aguardando = new Promise<void>((resolve) => { iniciou = resolve; });
  const barreira = new Promise<void>((resolve) => { liberar = resolve; });
  // Instancias distintas simulam processos diferentes, compartilhando o mesmo Bitrix.
  const porta = (atrasar: boolean): PortaBitrix => ({
    buscarEvento: (...args) => fake.buscarEvento(...args),
    criarEvento: async (evento: EventoCalendarioBitrix) => {
      if (atrasar) { iniciou(); await barreira; }
      return fake.criarEvento(evento);
    },
    removerEvento: (...args) => fake.removerEvento(...args),
    calendarioTrabalho: () => fake.calendarioTrabalho(),
    notificar: (...args) => fake.notificar(...args),
  });
  const dados = { pedidoId: p.id, ownerId: 1, inicio: p.inicio, fim: p.fim, tentativas: 0 };
  const criacao = executarSincronizacao(porta(true), { ...dados, operacao: "adicionar" });
  await aguardando;
  repo.cancelarPedido(m, { pedidoId: p.id, canceladoPor: "ana", canceladoEm: "2026-10-26", instante: agora });
  const script = `const repo = await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/ausencias/repo/index.ts")).href)}); console.log(JSON.stringify(repo.tomarProximoJob(${JSON.stringify(m)}, ${JSON.stringify(depois)}, "2026-10-26T15:00:00.000Z")));`;
  const outroProcesso = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./tests/registrar-alias.mjs", "--input-type=module", "-e", script], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  assert.equal(outroProcesso.status, 0, outroProcesso.stderr);
  assert.equal(outroProcesso.stdout.trim(), "null", "outro processo nao pode retomar nem remover add em voo");
  assert.equal(repo.tomarProximoJob(m, depois, "2026-10-26T15:00:00.000Z"), null);
  assert.notEqual(repo.lerPedidoInterno(m, p.id)?.sincronizacao, "removido");
  liberar();
  const criado = await criacao;
  assert.equal(criado.sincronizacao, "ok");
  repo.concluirJob(m, add!.id, depois, { bitrixEventId: criado.bitrixEventId }, add!.geracao);
  const remove = repo.tomarProximoJob(m, depois, "2026-10-26T15:00:00.000Z");
  assert.equal(remove?.operacao, "remover");
  const removido = await executarSincronizacao(porta(false), { ...dados, operacao: "remover", bitrixEventId: criado.bitrixEventId });
  assert.equal(removido.sincronizacao, "removido");
  repo.concluirJob(m, remove!.id, depois, undefined, remove!.geracao);
  assert.equal(repo.lerPedidoInterno(m, p.id)?.sincronizacao, "removido");
  assert.equal(fake.eventos().length, 0, "nenhum evento fantasma");
});

test("resultado incerto continua bloqueado mesmo apos cancelamento e reprocessamento", () => {
  const agora = "2026-10-26T12:00:00.000Z";
  const p = repo.criarPedido(m, {
    pessoaId: "ana", tipoId: "outro", inicio: "2027-02-11", fim: "2027-02-12",
    diasUteis: 2, diasDebitoPorAno: { "2027": 2 }, diasOcupados: ["2027-02-11", "2027-02-12"],
    excedeSaldo: false, criadoEm: agora,
  });
  repo.decidirPedido(m, { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: agora });
  const add = repo.tomarProximoJob(m, agora, "2026-10-26T13:00:00.000Z");
  assert.equal(add?.operacao, "adicionar");
  repo.registrarAddIncerto(m, add!.id, agora, add!.geracao);
  repo.cancelarPedido(m, { pedidoId: p.id, canceladoPor: "ana", canceladoEm: "2026-10-26", instante: agora });
  repo.reprocessarJobs(m, agora, p.id);
  assert.equal(repo.tomarProximoJob(m, "2026-10-26T14:00:00.000Z", "2026-10-26T15:00:00.000Z"), null);
  assert.notEqual(repo.lerPedidoInterno(m, p.id)?.sincronizacao, "removido");
  assert.match(repo.obterJob(m, add!.id)?.ultimoErro ?? "", /resultado incerto/);
});
