/** Fencing do lease e classificacao de falha anterior a escrita no sync com o Bitrix. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PortaBitrix } from "../src/lib/ausencias/portas.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-sync-fencing-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";
const { getDb } = await import("../src/lib/db/index.ts");
const { semearDemo, PORTAL_DEMO: m } = await import("../src/lib/ausencias/seed.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");
const { processarFilaSincronizacao } = await import("../src/lib/ausencias/servicos-sync.ts");
const { FakeBitrix } = await import("../src/lib/bitrix/ausencias/fake.ts");
const { ErroPortaBitrix } = await import("../src/lib/bitrix/ausencias/erros.ts");

after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

const T0 = "2026-10-26T12:00:00.000Z";
const T2 = "2026-10-26T14:00:00.000Z"; // lease de 1h ja venceu

function aprovado(inicio: string, fim: string) {
  const p = repo.criarPedido(m, {
    pessoaId: "ana", tipoId: "outro", inicio, fim,
    diasUteis: 2, diasDebitoPorAno: { [inicio.slice(0, 4)]: 2 }, diasOcupados: [inicio, fim],
    excedeSaldo: false, criadoEm: T0,
  });
  repo.decidirPedido(m, { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: T0 });
  return p;
}

function vincularBitrix() {
  getDb().prepare("UPDATE pessoa SET bitrix_user_id = 501 WHERE portal_member_id = ? AND id = 'ana'").run(m);
}

test("fencing: resultado de tentativa antiga (lease vencido) nao sobrescreve a tentativa nova", () => {
  semearDemo({ hoje: "2026-10-26" });
  vincularBitrix();
  const p = aprovado("2027-03-01", "2027-03-02");
  const add = repo.tomarProximoJob(m, T0, "2026-10-26T13:00:00.000Z");
  repo.concluirJob(m, add!.id, T0, { bitrixEventId: "evt-1", ownerId: 1 });
  repo.cancelarPedido(m, { pedidoId: p.id, canceladoPor: "ana", canceladoEm: "2026-10-26", instante: T0 });

  const antiga = repo.tomarProximoJob(m, T0, "2026-10-26T13:00:00.000Z"); // processo A
  assert.equal(antiga?.operacao, "remover");
  const nova = repo.tomarProximoJob(m, T2, "2026-10-26T15:00:00.000Z"); // processo B assume apos o lease vencer
  assert.equal(nova?.id, antiga?.id);
  assert.notEqual(nova?.geracao, antiga?.geracao, "cada tomada tem uma geracao propria");

  // A volta atrasado: nem falha nem sucesso dela podem valer.
  assert.throws(() => repo.esgotarJob(m, antiga!.id, "falha antiga", T2, 1, antiga!.geracao), /TRANSICAO_INVALIDA|nao esta em andamento|geracao/i);
  assert.throws(() => repo.falharJob(m, antiga!.id, "falha antiga", T2, undefined, antiga!.geracao), /TRANSICAO_INVALIDA|nao esta em andamento|geracao/i);
  assert.throws(() => repo.concluirJob(m, antiga!.id, T2, undefined, antiga!.geracao), /TRANSICAO_INVALIDA|nao esta em andamento|geracao/i);
  assert.equal(repo.obterJob(m, antiga!.id)?.estado, "em_andamento", "o job continua com a tentativa nova");

  // B conclui normalmente.
  repo.concluirJob(m, nova!.id, T2, undefined, nova!.geracao);
  assert.equal(repo.obterJob(m, nova!.id)?.estado, "ok");
  assert.equal(repo.lerPedidoInterno(m, p.id)?.sincronizacao, "removido");
});

function portaComCriacao(erro: Error): PortaBitrix {
  const fake = new FakeBitrix();
  return {
    buscarEvento: (...a) => fake.buscarEvento(...a),
    criarEvento: async () => { throw erro; },
    removerEvento: (...a) => fake.removerEvento(...a),
    calendarioTrabalho: () => fake.calendarioTrabalho(),
    notificar: (...a) => fake.notificar(...a),
  };
}

test("falha ANTERIOR a escrita (escrita bloqueada) nao vira criacao incerta: pode reprocessar", async () => {
  const p = aprovado("2027-04-05", "2027-04-06");
  const relogio = { hoje: () => "2026-10-26", agora: () => T0 };
  await processarFilaSincronizacao({
    portalMemberId: m, relogio,
    porta: portaComCriacao(new ErroPortaBitrix("ESCRITA_BLOQUEADA", "Escrita no portal Bitrix24 desligada")),
  });
  const job = repo.obterJobDoPedido(m, p.id, "adicionar");
  assert.equal(job?.estado, "falha_manual");
  assert.doesNotMatch(job?.ultimoErro ?? "", /incerto/i, "bloqueio e anterior a qualquer escrita: nao e incerteza");
  assert.equal(repo.reprocessarJobs(m, T2, p.id), 1, "o admin consegue reprocessar depois de liberar a escrita");
});

test("falha anterior a escrita nao bloqueia a remocao apos o cancelamento", async () => {
  const p = aprovado("2027-05-03", "2027-05-04");
  const relogio = { hoje: () => "2026-10-26", agora: () => T0 };
  await processarFilaSincronizacao({
    portalMemberId: m, relogio,
    porta: portaComCriacao(new ErroPortaBitrix("ESCRITA_BLOQUEADA", "Escrita no portal Bitrix24 desligada")),
  });
  repo.cancelarPedido(m, { pedidoId: p.id, canceladoPor: "ana", canceladoEm: "2026-10-26", instante: T0 });
  const fake = new FakeBitrix();
  const n = await processarFilaSincronizacao({ portalMemberId: m, relogio, porta: fake });
  assert.ok(n >= 1);
  assert.equal(repo.obterJobDoPedido(m, p.id, "remover")?.estado, "ok", "remocao concluida: nada foi criado, nada a desfazer");
});

test("erro GENUINAMENTE incerto (timeout depois de enviar a criacao) continua bloqueado", async () => {
  const p = aprovado("2027-06-07", "2027-06-08");
  const relogio = { hoje: () => "2026-10-26", agora: () => T0 };
  await processarFilaSincronizacao({
    portalMemberId: m, relogio,
    porta: portaComCriacao(new ErroPortaBitrix("TIMEOUT", "tempo esgotado depois do envio")),
  });
  const job = repo.obterJobDoPedido(m, p.id, "adicionar");
  assert.equal(job?.estado, "falha_manual");
  assert.match(job?.ultimoErro ?? "", /incerto/i);
  assert.equal(repo.reprocessarJobs(m, T2, p.id), 0, "resultado incerto exige reconciliacao manual");
});
