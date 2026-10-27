/** Achados da revisao final (27/10): cada teste reproduz um defeito antes da correcao. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CalendarioTrabalho, Relogio } from "../src/lib/ausencias/tipos.ts";
import type { PortaBitrix } from "../src/lib/ausencias/portas.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-revisao-final-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";
const { getDb } = await import("../src/lib/db/index.ts");
const { PORTAL_DEMO, semearDemo } = await import("../src/lib/ausencias/seed.ts");
const { criarServicosAusencias } = await import("../src/lib/ausencias/servicos-impl.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");
const { saldo } = await import("../src/lib/ausencias/saldo.ts");
const { calendarioDoPortal } = await import("../src/lib/ausencias/dias-uteis.ts");
const { intervaloQueConta } = await import("../src/lib/ausencias/cobertura.ts");
const { executarSincronizacao } = await import("../src/lib/bitrix/ausencias/executor.ts");
const { FakeBitrix } = await import("../src/lib/bitrix/ausencias/fake.ts");
const { TIPOS } = await import("./_helpers/fixtures.ts");

after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------- achado 1
test("cancelamento: o debito ja consumido vem dos dias realmente ocupados (pedido_dia), nao do calendario novo", async () => {
  semearDemo({ hoje: "2026-11-01" });
  let feriados: string[] = [];
  const porta: PortaBitrix = {
    async calendarioTrabalho(): Promise<CalendarioTrabalho> { return { diasNaoUteis: ["SA", "SU"], feriados, excecoesTrabalhadas: [] }; },
    async buscarEvento() { return null; },
    async criarEvento() { return { id: "fake" }; },
    async removerEvento() {},
    async notificar() {},
  };
  const servicos = (hoje: string) => {
    const relogio: Relogio = { hoje: () => hoje, agora: () => `${hoje}T12:00:00.000Z` };
    return criarServicosAusencias({ portalMemberId: PORTAL_DEMO, relogio, porta });
  };
  const antes = servicos("2026-11-01");
  antes.creditar({ pessoaId: "marina", papel: "admin" }, { pessoaId: "ana", carteira: "ferias", dias: 10, motivo: "Credito de 2026 para o teste", ano: 2026 });
  const pedido = await antes.solicitar({ pessoaId: "ana", papel: "colaborador" }, { tipoId: "ferias", inicio: "2026-11-02", fim: "2026-11-06" });
  await antes.decidir({ pessoaId: "carlos", papel: "gestor" }, pedido.id, { decisao: "aprovar", versao: pedido.versao });
  assert.deepEqual(repo.lerPedidoInterno(PORTAL_DEMO, pedido.id)?.diasDebitoPorAno, { "2026": 5 });

  feriados = ["11-03"]; // feriado cadastrado depois: 02 e 03/11 ja estavam ocupados
  await servicos("2026-11-04").cancelar({ pessoaId: "carlos", papel: "gestor" }, pedido.id);
  const cancelado = repo.lerPedidoInterno(PORTAL_DEMO, pedido.id);
  assert.equal(cancelado?.status, "cancelada");
  assert.deepEqual(cancelado?.diasDebitoPorAno, { "2026": 2 }, "02 e 03/11 foram dias ocupados e consumidos");
});

// ---------------------------------------------------------------- achado 2
test("saldo: as DATAS de consumo de um cancelado nao dependem do calendario atual", () => {
  const calSemFeriado = calendarioDoPortal({ diasNaoUteis: ["SA", "SU"], feriados: [], excecoesTrabalhadas: [] });
  const calComFeriado = calendarioDoPortal({ diasNaoUteis: ["SA", "SU"], feriados: ["2026-11-02"], excecoesTrabalhadas: [] });
  const cancelada = {
    id: 1, pessoaId: "ana", tipoId: "ferias", inicio: "2026-11-02", fim: "2026-11-13",
    status: "cancelada" as const, sincronizacao: "removido" as const, canceladoEm: "2026-11-05",
    diasDebitoPorAno: { "2026": 2 },
  };
  const lancamentos = [
    { id: 1, pessoaId: "ana", carteira: "ferias" as const, tipo: "credito" as const, dias: 1, motivo: "A", ano: 2026, venceEm: "2026-11-02", criadoPor: "marina", criadoEm: "2026-01-01T00:00:00.000Z" },
    { id: 2, pessoaId: "ana", carteira: "ferias" as const, tipo: "credito" as const, dias: 1, motivo: "B", ano: 2026, venceEm: "2026-11-03", criadoPor: "marina", criadoEm: "2026-01-01T00:00:00.000Z" },
  ];
  // `hoje` depois dos vencimentos: lote nao usado vira "vencido" e o excedente aparece.
  const base = { pessoaId: "ana", carteira: "ferias" as const, hoje: "2026-11-10", lancamentos, pedidos: [cancelada], tipos: TIPOS };
  const a = saldo({ ...base, cal: calSemFeriado });
  const b = saldo({ ...base, cal: calComFeriado });
  assert.equal(a.disponivel, 0);
  assert.equal(a.excedente, 0);
  assert.equal(a.vencidos, 0);
  assert.deepEqual(b, a, "feriado cadastrado depois nao pode mudar o consumo ja ocorrido");
});

// ---------------------------------------------------------------- achado 3
test("executor: job invalido (nenhuma chamada a porta) e semEscrita", async () => {
  const fake = new FakeBitrix();
  const r = await executarSincronizacao(fake, { operacao: "adicionar", pedidoId: 1, ownerId: 0, inicio: "2027-01-11", fim: "2027-01-12", tentativas: 0 });
  assert.equal(r.sincronizacao, "falha_manual");
  assert.equal(r.semEscrita, true, "validacao falhou antes de qualquer escrita");
  assert.equal(fake.eventos().length, 0);
});

// ---------------------------------------------------------------- achado 4
test("fencing e obrigatorio: gravar resultado sem a geracao e recusado", () => {
  semearDemo({ hoje: "2026-11-01" });
  const agora = "2026-11-01T12:00:00.000Z";
  const p = repo.criarPedido(PORTAL_DEMO, {
    pessoaId: "bruno", tipoId: "outro", inicio: "2027-02-01", fim: "2027-02-02",
    diasUteis: 2, diasDebitoPorAno: { "2027": 2 }, diasOcupados: ["2027-02-01", "2027-02-02"], excedeSaldo: false, criadoEm: agora,
  });
  repo.decidirPedido(PORTAL_DEMO, { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: agora });
  const job = repo.tomarProximoJob(PORTAL_DEMO, agora, "2026-11-01T13:00:00.000Z", p.id);
  assert.ok(job);
  const semToken = (fn: () => unknown) => assert.throws(fn, /geracao/i);
  semToken(() => repo.concluirJob(PORTAL_DEMO, job!.id, agora, undefined, undefined as unknown as number));
  semToken(() => repo.falharJob(PORTAL_DEMO, job!.id, "x", agora, undefined, undefined as unknown as number));
  semToken(() => repo.esgotarJob(PORTAL_DEMO, job!.id, "x", agora, 1, undefined as unknown as number));
  semToken(() => repo.registrarAddIncerto(PORTAL_DEMO, job!.id, agora, undefined as unknown as number));
  assert.equal(repo.obterJob(PORTAL_DEMO, job!.id)?.estado, "em_andamento", "nada foi gravado");
});

// ---------------------------------------------------------------- achado 5
test("cobertura: cancelado depois de aprovado conta ate canceladoEm mesmo com sincronizacao nao_aplicavel", () => {
  const base = { pessoaId: "ana", inicio: "2026-11-02", fim: "2026-11-06", status: "cancelada" as const, canceladoEm: "2026-11-04" };
  const aprovadoDepoisCancelado = { ...base, sincronizacao: "nao_aplicavel" as const, decididoEm: "2026-10-30T12:00:00.000Z" };
  assert.deepEqual(intervaloQueConta(aprovadoDepoisCancelado, false), { inicio: "2026-11-02", fim: "2026-11-03" });
  const nuncaDecidido = { ...base, sincronizacao: "nao_aplicavel" as const };
  assert.equal(intervaloQueConta(nuncaDecidido, false), null, "pendente cancelado nao entra sem contarPendentes");
  assert.deepEqual(intervaloQueConta(nuncaDecidido, true), { inicio: "2026-11-02", fim: "2026-11-03" });
});

// ---------------------------------------------------------------- achado 6
test("creditar sem `ano`: vencimento anterior a competencia aplicada e rejeitado", () => {
  semearDemo({ hoje: "2026-11-01" });
  const relogio: Relogio = { hoje: () => "2026-11-01", agora: () => "2026-11-01T12:00:00.000Z" };
  const sv = criarServicosAusencias({ portalMemberId: PORTAL_DEMO, relogio, porta: new FakeBitrix() });
  assert.throws(
    () => sv.creditar({ pessoaId: "marina", papel: "admin" }, { pessoaId: "ana", carteira: "folga", dias: 1, motivo: "Credito ja vencido na origem", venceEm: "2025-12-31" }),
    (e: unknown) => {
      const txt = JSON.stringify(e instanceof Error ? { m: e.message, ...(e as object) } : e);
      assert.match(txt, /venceEm/);
      return true;
    },
  );
  const n = getDb().prepare("SELECT COUNT(*) AS n FROM lancamento WHERE portal_member_id = ? AND motivo = 'Credito ja vencido na origem'").get(PORTAL_DEMO) as { n: number };
  assert.equal(n.n, 0);
});
