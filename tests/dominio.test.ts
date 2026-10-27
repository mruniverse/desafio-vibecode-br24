/**
 * Testes do nucleo de dominio puro de ausencias (BR24-005, C1).
 *
 *   npm run test:dominio
 *
 * Dados 100% ficticios (tests/_helpers/fixtures.ts). `hoje`/`agora` sempre por
 * parametro: nenhum teste depende do relogio da maquina.
 *
 * Calendario de referencia: sabado/domingo nao uteis; feriados fixos 25/12 e
 * 01/01. 2026-10-26 e segunda-feira.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as datas from "../src/lib/ausencias/datas.ts";
import * as diasUteis from "../src/lib/ausencias/dias-uteis.ts";
import * as saldoMod from "../src/lib/ausencias/saldo.ts";
import * as estados from "../src/lib/ausencias/estados.ts";
import * as cobertura from "../src/lib/ausencias/cobertura.ts";
import * as janela from "../src/lib/ausencias/janela.ts";
import * as indicadoresMod from "../src/lib/ausencias/indicadores.ts";
import { ErroDominio, type SubcodigoDominio } from "../src/lib/ausencias/erros.ts";
import type { Equipe, Lancamento, Pedido, StatusPedido, StatusSincronizacao } from "../src/lib/ausencias/tipos.ts";
import { ADMINS, EQUIPE_TEC, PESSOAS_TEC, TIPOS } from "./_helpers/fixtures.ts";
import { relogioFixo } from "./_helpers/relogio.ts";

const { somarDias, somarAnos, intervaloInclusivo, sobrepoe, ehDataISO, ehInstanteISO } = datas;
const { calendarioDoPortal, contarDiasUteis, diasUteisEntre, ehDiaUtil, ehFeriado } = diasUteis;
const { saldo, simularPedido, diasDebitoPorAno } = saldoMod;
const { pessoasTrabalhandoPorDia, piorDiaPorSemana, contarDiasAbaixoDoMinimo, haConflitoDeEquipe, verificarSobreposicao } =
  cobertura;
const { melhorJanela } = janela;
const { indicadores } = indicadoresMod;

// ------------------------------------------------------------------ apoio

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CAL = calendarioDoPortal({ diasNaoUteis: ["SA", "SU"], feriados: ["12-25", "01-01"], excecoesTrabalhadas: [] });
const HOJE = relogioFixo().hoje();
const AGORA = relogioFixo().agora();
const TODAS_PESSOAS = [...PESSOAS_TEC, ...ADMINS];

function lanca(fn: () => unknown, subcodigo: SubcodigoDominio) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof ErroDominio, `esperava ErroDominio, veio ${String(e)}`);
    assert.equal(e.subcodigo, subcodigo);
    return true;
  });
}

function ped(id: number, pessoaId: string, inicio: string, fim: string, extra: Partial<Pedido> = {}): Pedido {
  const porAno = diasDebitoPorAno(inicio, fim, CAL);
  return {
    id,
    pessoaId,
    tipoId: "ferias",
    inicio,
    fim,
    diasUteis: saldoMod.totalDebito(porAno),
    diasDebitoPorAno: porAno,
    status: "aprovada",
    sincronizacao: "ok",
    excedeSaldo: false,
    criadoEm: "2026-10-20T12:00:00.000Z",
    versao: 1,
    ...extra,
  };
}

function cred(id: number, dias: number, extra: Partial<Lancamento> = {}): Lancamento {
  return {
    id,
    pessoaId: "ana",
    ano: 2026,
    carteira: "ferias",
    tipo: "credito",
    dias,
    motivo: "Credito anual ficticio",
    criadoPor: "marina",
    criadoEm: "2026-01-02T12:00:00.000Z",
    ...extra,
  };
}

function entradaSaldo(pedidos: Pedido[], lancamentos: Lancamento[], hoje = HOJE) {
  return { pessoaId: "ana", carteira: "ferias" as const, hoje, lancamentos, pedidos, tipos: TIPOS, cal: CAL };
}

function entradaCobertura(pedidos: Pedido[], de: string, ate: string, equipe: Equipe = EQUIPE_TEC) {
  return { equipe, pessoas: TODAS_PESSOAS, pedidos, cal: CAL, de, ate };
}

// ------------------------------------------------------------------ datas

test("datas: ehDataISO cobre ano bissexto, mes/dia invalido e anos < 100", () => {
  assert.equal(ehDataISO("2028-02-29"), true);
  assert.equal(ehDataISO("2026-02-29"), false);
  assert.equal(ehDataISO("2026-13-01"), false);
  assert.equal(ehDataISO("2026-04-31"), false);
  assert.equal(ehDataISO("2026-1-01"), false);
  assert.equal(ehDataISO("abc"), false);
  assert.equal(ehDataISO(20260101), false);
  assert.equal(ehDataISO(null), false);
  // anos < 100: Date.UTC os trataria como 19xx.
  assert.equal(ehDataISO("0099-12-31"), true);
  assert.equal(ehDataISO("0099-02-29"), false);
  assert.equal(ehDataISO("0004-02-29"), true);
  assert.equal(ehDataISO("0100-02-29"), false);
  assert.equal(ehDataISO("0000-02-29"), true);
  assert.equal(datas.paraDate("0099-03-01").getUTCFullYear(), 99);
});

test("datas: somarDias, meses, anos, negativos e limites", () => {
  assert.equal(somarDias("2026-10-31", 1), "2026-11-01");
  assert.equal(somarDias("2026-12-31", 1), "2027-01-01");
  assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
  assert.equal(somarDias("2028-03-01", -1), "2028-02-29");
  assert.equal(somarDias("2026-10-26", 0), "2026-10-26");
  assert.equal(somarDias("0001-01-01", -1), "0000-12-31");
  lanca(() => somarDias("2026-01-01", Number.NaN), "NUMERO_INVALIDO");
  lanca(() => somarDias("2026-01-01", Number.POSITIVE_INFINITY), "NUMERO_INVALIDO");
  lanca(() => somarDias("2026-01-01", 1.5), "NUMERO_INVALIDO");
  lanca(() => somarDias("2026-01-01", "1" as never), "NUMERO_INVALIDO");
  lanca(() => somarDias("2026-01-01", undefined as never), "NUMERO_INVALIDO");
  lanca(() => somarDias("abc", 1), "DATA_INVALIDA");
  lanca(() => somarDias("9999-12-31", 1), "DATA_INVALIDA");
  lanca(() => somarDias("2026-01-01", 1e300), "DATA_INVALIDA");
});

test("datas: somarAnos trata 29/02 e valida entrada", () => {
  assert.equal(somarAnos("2028-02-29", 1), "2029-02-28");
  assert.equal(somarAnos("2028-02-29", 4), "2032-02-29");
  assert.equal(somarAnos("2026-10-26", -1), "2025-10-26");
  lanca(() => somarAnos("2026-01-01", Number.NaN), "NUMERO_INVALIDO");
  lanca(() => somarAnos("9999-01-01", 1), "DATA_INVALIDA");
  lanca(() => somarAnos("2026-02-30", 1), "DATA_INVALIDA");
});

test("datas: dia da semana, inicio da semana (segunda) e ano", () => {
  assert.equal(datas.diaDaSemana("2026-10-26"), 1);
  assert.equal(datas.diaDaSemana("2026-11-01"), 0);
  assert.equal(datas.inicioDaSemana("2026-10-26"), "2026-10-26");
  assert.equal(datas.inicioDaSemana("2026-11-01"), "2026-10-26");
  assert.equal(datas.inicioDaSemana("2026-11-02"), "2026-11-02");
  assert.equal(datas.anoDe("2027-01-01"), 2027);
});

test("datas: intervaloInclusivo, diasEntre e limites", () => {
  assert.deepEqual(intervaloInclusivo("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(intervaloInclusivo("2026-10-26", "2026-10-26"), ["2026-10-26"]);
  assert.equal(datas.diasEntre("2026-10-26", "2026-10-26"), 1);
  assert.equal(datas.diasEntre("2026-12-31", "2027-01-01"), 2);
  assert.equal(intervaloInclusivo("2026-01-01", "2026-12-31").length, 365);
  assert.equal(intervaloInclusivo("2028-01-01", "2028-12-31").length, 366);
  lanca(() => intervaloInclusivo("2026-01-01", "2027-01-02"), "INTERVALO_LONGO");
  lanca(() => intervaloInclusivo("2026-02-01", "2026-01-01"), "INTERVALO_INVALIDO");
  lanca(() => intervaloInclusivo("abc", "abc"), "DATA_INVALIDA");
});

test("datas: sobrepoe inclui a fronteira e valida", () => {
  const a = { inicio: "2026-11-02", fim: "2026-11-06" };
  assert.equal(sobrepoe(a, { inicio: "2026-11-06", fim: "2026-11-10" }), true);
  assert.equal(sobrepoe(a, { inicio: "2026-11-07", fim: "2026-11-10" }), false);
  assert.equal(sobrepoe(a, { inicio: "2026-10-01", fim: "2026-11-02" }), true);
  assert.equal(sobrepoe(a, { inicio: "2026-10-01", fim: "2026-11-01" }), false);
  lanca(() => sobrepoe(a, { inicio: "abc", fim: "2026-11-10" }), "DATA_INVALIDA");
  lanca(() => sobrepoe({ inicio: "2026-11-10", fim: "2026-11-01" }, a), "INTERVALO_INVALIDO");
});

test("datas: instantes (validacao, comparacao, soma de horas)", () => {
  assert.equal(ehInstanteISO("2026-10-26T12:00:00.000Z"), true);
  assert.equal(ehInstanteISO("2026-10-26T12:00:00Z"), true);
  assert.equal(ehInstanteISO("2026-10-26T24:00:00.000Z"), false);
  assert.equal(ehInstanteISO("2026-10-26"), false);
  assert.equal(ehInstanteISO("2026-02-30T00:00:00.000Z"), false);
  assert.equal(datas.instanteParaMs("1970-01-01T00:00:01.500Z"), 1500);
  assert.equal(datas.instanteParaMs("1970-01-02T00:00:00Z"), 86_400_000);
  assert.ok(datas.compararInstantes("2026-10-26T12:00:00.000Z", "2026-10-26T12:00:00.001Z") < 0);
  assert.equal(datas.compararInstantes("2026-10-26T12:00:00Z", "2026-10-26T12:00:00.000Z"), 0);
  assert.equal(datas.somarHoras("2026-10-26T22:00:00.000Z", 5), "2026-10-27T03:00:00.000Z");
  assert.equal(datas.somarHoras("2026-10-26T01:00:00.000Z", -2), "2026-10-25T23:00:00.000Z");
  assert.equal(datas.horasEntre("2026-10-26T00:00:00.000Z", "2026-10-27T12:00:00.000Z"), 36);
  assert.equal(datas.deDate(new Date(Date.UTC(2026, 9, 26))), "2026-10-26");
});

// ------------------------------------------------------------------ dias uteis

test("dias uteis: calendarioDoPortal(null) = sabado e domingo, sem feriado", () => {
  const cal = calendarioDoPortal(null);
  assert.equal(ehDiaUtil("2026-10-26", cal), true); // segunda
  assert.equal(ehDiaUtil("2026-10-31", cal), false); // sabado
  assert.equal(ehDiaUtil("2026-11-01", cal), false); // domingo
  assert.equal(ehDiaUtil("2026-12-25", cal), true); // sem feriado cadastrado
  assert.equal(contarDiasUteis("2026-10-26", "2026-11-01", cal), 5);
  assert.equal(diasUteis.avisosDeConfiguracao(cal).length, 1);
});

test("dias uteis: feriado fixo, feriado do ano, excecao trabalhada e folga semanal", () => {
  const cal = calendarioDoPortal({
    diasNaoUteis: ["sa", "SU", "FR"],
    feriados: ["12-25", "2026-11-02", "02-29"],
    excecoesTrabalhadas: ["2026-11-07", "2026-12-25"],
  });
  assert.equal(ehDiaUtil("2026-11-02", cal), false); // feriado do ano
  assert.equal(ehDiaUtil("2027-11-02", cal), true); // so vale em 2026
  assert.equal(ehDiaUtil("2026-11-07", cal), true); // sabado trabalhado
  assert.equal(ehDiaUtil("2026-12-25", cal), true); // excecao vence feriado fixo
  assert.equal(ehFeriado("2026-12-25", cal), false);
  assert.equal(ehFeriado("2027-12-25", cal), true);
  assert.equal(ehDiaUtil("2028-02-29", cal), false);
  assert.equal(ehDiaUtil("2026-11-06", cal), false); // sexta = folga semanal
  assert.deepEqual(diasUteisEntre("2026-11-02", "2026-11-08", cal), ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-07"]);
  assert.equal(diasUteis.avisosDeConfiguracao(cal).length, 0);
});

test("dias uteis: feriado em fim de ano nao conta e contagem e inclusiva", () => {
  assert.equal(contarDiasUteis("2026-12-28", "2027-01-05", CAL), 6);
  assert.equal(contarDiasUteis("2026-12-25", "2026-12-25", CAL), 0);
  assert.equal(contarDiasUteis("2026-10-26", "2026-10-26", CAL), 1);
  assert.equal(ehFeriado("2027-01-01", CAL), true);
  assert.equal(ehFeriado("2026-10-26", CAL), false);
});

test("dias uteis: calendario malformado lanca (nao descarta feriado em silencio)", () => {
  lanca(() => calendarioDoPortal({ diasNaoUteis: ["XX"], feriados: [], excecoesTrabalhadas: [] }), "DATA_INVALIDA");
  lanca(() => calendarioDoPortal({ diasNaoUteis: ["SA"], feriados: ["13-45"], excecoesTrabalhadas: [] }), "DATA_INVALIDA");
  lanca(() => calendarioDoPortal({ diasNaoUteis: ["SA"], feriados: ["25.12"], excecoesTrabalhadas: [] }), "DATA_INVALIDA");
  lanca(() => calendarioDoPortal({ diasNaoUteis: ["SA"], feriados: [], excecoesTrabalhadas: ["2026-02-30"] }), "DATA_INVALIDA");
  lanca(() => calendarioDoPortal({ diasNaoUteis: "SA" as never, feriados: [], excecoesTrabalhadas: [] }), "DATA_INVALIDA");
});

// ------------------------------------------------------------------ saldo

test("saldo: 22 ferias - 10 dias aprovados = 12 (cena do pitch)", () => {
  const r = saldo(entradaSaldo([ped(1, "ana", "2026-11-02", "2026-11-13")], [cred(1, 22)]));
  assert.equal(r.disponivel, 12);
  assert.equal(r.excedente, 0);
});

test("saldo: pendente reserva, recusada nao debita, outra pessoa e outra carteira nao interferem", () => {
  const base = [cred(1, 22), cred(2, 5, { carteira: "folga" }), cred(3, 9, { pessoaId: "bruno" })];
  const umaSemana = (id: number, extra: Partial<Pedido>) => ped(id, "ana", "2026-11-02", "2026-11-06", extra);
  assert.equal(saldo(entradaSaldo([umaSemana(1, { status: "pendente", sincronizacao: "nao_aplicavel" })], base)).disponivel, 17);
  assert.equal(saldo(entradaSaldo([umaSemana(1, { status: "recusada", sincronizacao: "nao_aplicavel" })], base)).disponivel, 22);
  assert.equal(saldo(entradaSaldo([ped(1, "bruno", "2026-11-02", "2026-11-06")], base)).disponivel, 22);
  assert.equal(saldo(entradaSaldo([umaSemana(1, { tipoId: "outro" })], base)).disponivel, 22); // tipo sem saldo
  assert.equal(saldo(entradaSaldo([umaSemana(1, { tipoId: "folga" })], base)).disponivel, 22); // debita folga, nao ferias
  assert.equal(saldo({ ...entradaSaldo([umaSemana(1, { tipoId: "folga" })], base), carteira: "folga" }).disponivel, 0);
});

test("saldo: aprovada com sincronizacao em falha continua debitando (depende so de status)", () => {
  const p = ped(1, "ana", "2026-11-02", "2026-11-06", { sincronizacao: "falha" });
  assert.equal(saldo(entradaSaldo([p], [cred(1, 22)])).disponivel, 17);
});

test("saldo: cancelamento usa canceladoEm (estorna so dias uteis >= canceladoEm)", () => {
  // Como o servico faz no cancelamento: regrava o debito so ate canceladoEm-1.
  const cancelada = (canceladoEm: string) => {
    const ultimo = somarDias(canceladoEm, -1);
    const fimVigente = ultimo < "2026-11-13" ? ultimo : "2026-11-13";
    const debito = fimVigente < "2026-11-02" ? {} : diasDebitoPorAno("2026-11-02", fimVigente, CAL);
    return ped(1, "ana", "2026-11-02", "2026-11-13", {
      status: "cancelada",
      sincronizacao: "removido",
      canceladoEm,
      diasDebitoPorAno: debito,
    });
  };
  const lanc = [cred(1, 22)];
  assert.equal(saldo(entradaSaldo([cancelada("2026-11-02")], lanc)).disponivel, 22); // antes do primeiro dia
  assert.equal(saldo(entradaSaldo([cancelada("2026-10-26")], lanc)).disponivel, 22);
  assert.equal(saldo(entradaSaldo([cancelada("2026-11-06")], lanc)).disponivel, 18); // 02,03,04,05 ja usados
  assert.equal(saldo(entradaSaldo([cancelada("2026-11-14")], lanc)).disponivel, 12); // depois do fim: nada estorna
  assert.equal(saldo(entradaSaldo([cancelada("2026-12-01")], lanc)).disponivel, 12);
});

test("saldo: debito persistido no cancelamento nao muda se o calendario mudar depois (feriado retroativo)", () => {
  // Cancelada em 04/11: 02 e 03/11 (2 dias uteis) ja consumidos e gravados em diasDebitoPorAno.
  const cancelada = ped(1, "ana", "2026-11-02", "2026-11-13", {
    status: "cancelada",
    sincronizacao: "removido",
    canceladoEm: "2026-11-04",
    diasDebitoPorAno: { "2026": 2 },
  });
  const lanc = [cred(1, 22)];
  assert.equal(saldo(entradaSaldo([cancelada], lanc)).disponivel, 20);
  // Feriado cadastrado depois, dentro dos dias ja gozados: o historico nao pode encolher.
  const calComFeriado = calendarioDoPortal({ diasNaoUteis: ["SA", "SU"], feriados: ["12-25", "01-01", "2026-11-02"], excecoesTrabalhadas: [] });
  const depois = saldo({ ...entradaSaldo([cancelada], lanc), cal: calComFeriado });
  assert.equal(depois.disponivel, 20, "o debito congelado no cancelamento e a autoridade");
});

test("saldo: fronteira venceEm = hoje conta; no dia seguinte vence", () => {
  const lanc = [cred(1, 5, { venceEm: "2026-10-26" })];
  const noDia = saldo(entradaSaldo([], lanc, "2026-10-26"));
  assert.equal(noDia.disponivel, 5);
  assert.equal(noDia.vencidos, 0);
  assert.deepEqual(noDia.vencendo, { dias: 5, venceEm: "2026-10-26" });
  const depois = saldo(entradaSaldo([], lanc, "2026-10-27"));
  assert.equal(depois.disponivel, 0);
  assert.equal(depois.vencidos, 5);
  assert.equal(depois.vencendo, null);
});

test("saldo: fronteira venceEm = dia de uso (usa o lote); dia seguinte nao usa", () => {
  const lanc = [cred(1, 1, { venceEm: "2026-10-26" }), cred(2, 1, { venceEm: "2026-12-31" })];
  // uso em 26/10 (segunda): consome o lote que vence nesse mesmo dia.
  const noDia = saldo(entradaSaldo([ped(1, "ana", "2026-10-26", "2026-10-26")], lanc, "2026-10-20"));
  assert.deepEqual(noDia.lotes.map((l) => [l.lancamentoId, l.dias]), [[2, 1]]);
  // uso em 27/10: o lote de 26/10 ja venceu naquele dia, entao consome o de 31/12.
  const diaSeguinte = saldo(entradaSaldo([ped(1, "ana", "2026-10-27", "2026-10-27")], lanc, "2026-10-20"));
  assert.deepEqual(diaSeguinte.lotes.map((l) => [l.lancamentoId, l.dias]), [[1, 1]]);
  assert.deepEqual(diaSeguinte.vencendo, { dias: 1, venceEm: "2026-10-26" });
  // e depois que o lote de 26/10 vence sobra 0 disponivel (1 dia vencido).
  const aposVencer = saldo(entradaSaldo([ped(1, "ana", "2026-10-27", "2026-10-27")], lanc, "2026-10-28"));
  assert.equal(aposVencer.disponivel, 0);
  assert.equal(aposVencer.vencidos, 1);
});

test("saldo: FIFO consome o credito que vence primeiro; sem vencimento por ultimo", () => {
  const lanc = [
    cred(1, 5, { venceEm: "2027-03-31" }),
    cred(2, 5, { venceEm: "2026-12-31" }),
    cred(3, 5), // sem vencimento
  ];
  const r = saldo(entradaSaldo([ped(1, "ana", "2026-11-02", "2026-11-04")], lanc, "2026-10-26")); // 3 dias
  assert.deepEqual(r.lotes.map((l) => [l.lancamentoId, l.dias]), [[2, 2], [1, 5], [3, 5]]);
  assert.equal(r.disponivel, 12);
  assert.deepEqual(r.vencendo, { dias: 2, venceEm: "2026-12-31" });
});

test("saldo: pedido que cruza dez/jan divide o debito por ano e nao toca o ano errado", () => {
  const p = ped(1, "ana", "2026-12-28", "2027-01-05");
  assert.deepEqual(p.diasDebitoPorAno, { "2026": 4, "2027": 2 });
  assert.equal(p.diasUteis, 6);
  const dois = saldo(entradaSaldo([p], [cred(1, 5, { ano: 2026 }), cred(2, 5, { ano: 2027 })], "2026-10-26"));
  assert.deepEqual(dois.lotes.map((l) => [l.ano, l.dias]), [[2026, 1], [2027, 3]]);
  assert.equal(dois.disponivel, 4);
  assert.equal(dois.excedente, 0);
  // credito so de 2026: os 2 dias de 2027 nao saem dele; viram excedente.
  const so2026 = saldo(entradaSaldo([p], [cred(1, 10, { ano: 2026 })], "2026-10-26"));
  assert.equal(so2026.excedente, 2);
  assert.equal(so2026.disponivel, 4);
  assert.deepEqual(so2026.lotes.map((l) => [l.ano, l.dias]), [[2026, 6]]);
});

test("saldo: excedente deixa o disponivel negativo; ajuste soma e ajuste negativo baixa", () => {
  const r = saldo(entradaSaldo([ped(1, "ana", "2026-11-02", "2026-11-06")], [cred(1, 3)]));
  assert.equal(r.disponivel, -2);
  assert.equal(r.excedente, 2);
  assert.equal(saldo(entradaSaldo([], [cred(1, 10), cred(2, 2, { tipo: "ajuste" })])).disponivel, 12);
  assert.equal(saldo(entradaSaldo([], [cred(1, 10), cred(2, -3, { tipo: "ajuste" })])).disponivel, 7);
  assert.equal(saldo(entradaSaldo([], [cred(1, 2), cred(2, -3, { tipo: "ajuste" })])).disponivel, -1);
  assert.equal(saldo(entradaSaldo([], [])).disponivel, 0);
});

test("saldo: credito de outra competencia nao cobre pedido nem dispensa justificativa", () => {
  const base = { ...entradaSaldo([], [cred(1, 5, { ano: 2027 })]), tipoId: "ferias", inicio: "2026-11-02", fim: "2026-11-05" };
  const simulacao = simularPedido(base);
  assert.equal(simulacao.saldoDepois, 1);
  assert.equal(simulacao.excedeSaldo, true);
});

test("saldo: simularPedido calcula antes/depois, excedente e tipo sem saldo", () => {
  const existente = ped(1, "ana", "2026-11-02", "2026-11-13"); // 10 dias
  const base = { ...entradaSaldo([existente], [cred(1, 22)]), tipoId: "ferias" };
  const cabe = simularPedido({ ...base, inicio: "2026-12-07", fim: "2026-12-18" }); // 10 uteis
  assert.equal(cabe.diasUteis, 10);
  assert.equal(cabe.saldoAntes, 12);
  assert.equal(cabe.saldoDepois, 2);
  assert.equal(cabe.excedeSaldo, false);
  const justo = simularPedido({ ...base, inicio: "2026-12-07", fim: "2026-12-22" }); // 12 uteis -> 0
  assert.equal(justo.saldoDepois, 0);
  assert.equal(justo.excedeSaldo, false);
  const excede = simularPedido({ ...base, inicio: "2026-12-07", fim: "2026-12-23" }); // 13 uteis -> -1
  assert.equal(excede.saldoDepois, -1);
  assert.equal(excede.excedeSaldo, true);
  const semSaldo = simularPedido({ ...base, tipoId: "viagem", inicio: "2026-12-07", fim: "2026-12-18" });
  assert.equal(semSaldo.saldoAntes, null);
  assert.equal(semSaldo.saldoDepois, null);
  assert.equal(semSaldo.excedeSaldo, false);
  assert.equal(semSaldo.diasUteis, 10);
  assert.equal(saldoMod.totalDebito({ "2026": 4, "2027": 2 }), 6);
});

test("saldo: entrada invalida lanca com o subcodigo certo", () => {
  const ok = entradaSaldo([], [cred(1, 5)]);
  lanca(() => saldo({ ...ok, hoje: "abc" }), "DATA_INVALIDA");
  lanca(() => saldo({ ...ok, carteira: "outra" as never }), "NAO_ENCONTRADO");
  lanca(() => saldo({ ...ok, pessoaId: "" }), "NAO_ENCONTRADO");
  lanca(() => saldo({ ...ok, lancamentos: [cred(1, 0.5)] }), "NUMERO_INVALIDO");
  lanca(() => saldo({ ...ok, lancamentos: [cred(1, 0)] }), "NUMERO_INVALIDO");
  lanca(() => saldo({ ...ok, lancamentos: [cred(1, -2)] }), "NUMERO_INVALIDO");
  lanca(() => saldo({ ...ok, lancamentos: [cred(1, 5, { venceEm: "31/12/2026" })] }), "DATA_INVALIDA");
  lanca(() => saldo({ ...ok, lancamentos: [cred(1, 5, { tipo: "debito" as never })] }), "NUMERO_INVALIDO");
  lanca(() => saldo({ ...ok, pedidos: [ped(1, "ana", "2026-11-02", "2026-11-06", { tipoId: "inexistente" })] }), "NAO_ENCONTRADO");
  lanca(
    () => saldo({ ...ok, pedidos: [ped(1, "ana", "2026-11-02", "2026-11-06", { status: "cancelada", sincronizacao: "removido" })] }),
    "DATA_INVALIDA",
  );
  lanca(() => saldo({ ...ok, pedidos: [ped(1, "ana", "2026-11-02", "2026-11-06", { diasDebitoPorAno: { x: 1 } })] }), "NUMERO_INVALIDO");
  lanca(() => saldo({ ...ok, pedidos: [ped(1, "ana", "2026-11-02", "2026-11-06", { diasDebitoPorAno: { "2026": -1 } })] }), "NUMERO_INVALIDO");
  lanca(() => diasDebitoPorAno("abc", "2026-01-01", CAL), "DATA_INVALIDA");
  lanca(() => diasDebitoPorAno("2026-02-01", "2026-01-01", CAL), "INTERVALO_INVALIDO");
  lanca(() => diasDebitoPorAno("2026-01-01", "9999-12-31", CAL), "INTERVALO_LONGO");
  lanca(() => saldoMod.totalDebito({ "2026": 1.5 }), "NUMERO_INVALIDO");
  lanca(() => simularPedido({ ...ok, tipoId: "inexistente", inicio: "2026-11-02", fim: "2026-11-06" }), "NAO_ENCONTRADO");
});

// ------------------------------------------------------------------ estados

const STATUS: StatusPedido[] = ["pendente", "aprovada", "recusada", "cancelada"];
const SINCS: StatusSincronizacao[] = [
  "nao_aplicavel",
  "pendente",
  "em_andamento",
  "ok",
  "falha",
  "remocao_pendente",
  "removido",
  "falha_manual",
];

/** Matriz esperada, escrita a mao na v2.2 item 1 (independente da implementacao). */
const VALIDAS = new Set([
  "pendente/nao_aplicavel",
  "recusada/nao_aplicavel",
  "aprovada/pendente",
  "aprovada/em_andamento",
  "aprovada/ok",
  "aprovada/falha",
  "aprovada/falha_manual",
  "cancelada/nao_aplicavel",
  "cancelada/remocao_pendente",
  "cancelada/em_andamento",
  "cancelada/removido",
  "cancelada/falha",
  "cancelada/falha_manual",
]);
const ARESTAS = new Set([
  "pendente/nao_aplicavel>aprovada/pendente",
  "pendente/nao_aplicavel>recusada/nao_aplicavel",
  "pendente/nao_aplicavel>cancelada/nao_aplicavel",
  "aprovada/pendente>aprovada/em_andamento",
  "aprovada/em_andamento>aprovada/ok",
  "aprovada/em_andamento>aprovada/falha",
  "aprovada/em_andamento>aprovada/falha_manual",
  "aprovada/falha>aprovada/em_andamento",
  "aprovada/falha_manual>aprovada/em_andamento",
  "aprovada/pendente>cancelada/remocao_pendente",
  "aprovada/em_andamento>cancelada/remocao_pendente",
  "aprovada/ok>cancelada/remocao_pendente",
  "aprovada/falha>cancelada/remocao_pendente",
  "aprovada/falha_manual>cancelada/remocao_pendente",
  "cancelada/remocao_pendente>cancelada/em_andamento",
  "cancelada/em_andamento>cancelada/removido",
  "cancelada/em_andamento>cancelada/falha",
  "cancelada/em_andamento>cancelada/falha_manual",
  "cancelada/falha>cancelada/em_andamento",
  "cancelada/falha_manual>cancelada/em_andamento",
]);

function pedidoEm(status: StatusPedido, sincronizacao: StatusSincronizacao, extra: Partial<Pedido> = {}): Pedido {
  return ped(7, "ana", "2026-11-02", "2026-11-06", { status, sincronizacao, ...extra });
}

test("estados: estadoValido aceita exatamente os 13 pares da v2.2", () => {
  let validos = 0;
  for (const status of STATUS) {
    for (const sincronizacao of SINCS) {
      const esperado = VALIDAS.has(`${status}/${sincronizacao}`);
      assert.equal(estados.estadoValido({ status, sincronizacao }), esperado, `${status}/${sincronizacao}`);
      if (esperado) validos += 1;
    }
  }
  assert.equal(validos, 13);
  assert.equal(estados.estadoValido({ status: "x" as never, sincronizacao: "ok" }), false);
  assert.equal(estados.estadoValido({ status: "toString" as never, sincronizacao: "ok" }), false);
});

test("estados: TODOS os 1024 pares origem->destino; invalidos lancam e deixam o estado intacto", () => {
  let permitidos = 0;
  let invalidos = 0;
  for (const s1 of STATUS) {
    for (const y1 of SINCS) {
      for (const s2 of STATUS) {
        for (const y2 of SINCS) {
          const de = `${s1}/${y1}`;
          const para = `${s2}/${y2}`;
          const esperado = ARESTAS.has(`${de}>${para}`);
          const origem = Object.freeze(pedidoEm(s1, y1, { canceladoEm: undefined }));
          const copia = structuredClone(origem);
          assert.equal(estados.transicaoPermitida(origem, { status: s2, sincronizacao: y2 }), esperado, `${de} > ${para}`);
          if (esperado) {
            permitidos += 1;
            const novo = estados.mudarEstado(origem, { status: s2, sincronizacao: y2 });
            assert.equal(novo.status, s2);
            assert.equal(novo.sincronizacao, y2);
          } else {
            invalidos += 1;
            assert.throws(
              () => estados.mudarEstado(origem, { status: s2, sincronizacao: y2 }),
              (e: unknown) => e instanceof ErroDominio && e.subcodigo === "TRANSICAO_INVALIDA",
              `${de} > ${para} deveria lancar`,
            );
          }
          assert.deepEqual(origem, copia, `${de} > ${para} alterou o estado`);
        }
      }
    }
  }
  assert.equal(permitidos, ARESTAS.size);
  assert.equal(ARESTAS.size, 20);
  assert.equal(permitidos + invalidos, 1024);
});

test("estados: recusada e cancelada sao terminais para o status", () => {
  for (const sincronizacao of SINCS) {
    for (const origem of ["recusada", "cancelada"] as const) {
      for (const destino of ["pendente", "aprovada", "recusada"] as const) {
        assert.equal(estados.transicaoPermitida({ status: origem, sincronizacao }, { status: destino, sincronizacao: "pendente" }), false);
      }
    }
  }
  assert.equal(estados.transicaoPermitida({ status: "recusada", sincronizacao: "nao_aplicavel" }, { status: "aprovada", sincronizacao: "pendente" }), false);
  assert.equal(estados.transicaoPermitida({ status: "aprovada", sincronizacao: "ok" }, { status: "recusada", sincronizacao: "nao_aplicavel" }), false);
  assert.equal(estados.transicaoPermitida({ status: "aprovada", sincronizacao: "ok" }, { status: "pendente", sincronizacao: "nao_aplicavel" }), false);
});

test("estados: aprovar muda status, registra decisor e nao aprova o proprio pedido", () => {
  const p = Object.freeze(pedidoEm("pendente", "nao_aplicavel"));
  const novo = estados.aprovar(p, "carlos", AGORA);
  assert.equal(novo.status, "aprovada");
  assert.equal(novo.sincronizacao, "pendente");
  assert.equal(novo.decididoPor, "carlos");
  assert.equal(novo.decididoEm, AGORA);
  assert.equal(p.status, "pendente"); // original intacto
  lanca(() => estados.aprovar(p, "ana", AGORA), "SEM_PERMISSAO");
  lanca(() => estados.aprovar(p, "", AGORA), "SEM_PERMISSAO");
  lanca(() => estados.aprovar(p, "carlos", "ontem"), "DATA_INVALIDA");
  lanca(() => estados.aprovar(pedidoEm("aprovada", "ok"), "carlos", AGORA), "TRANSICAO_INVALIDA");
  lanca(() => estados.aprovar(pedidoEm("recusada", "nao_aplicavel"), "carlos", AGORA), "TRANSICAO_INVALIDA");
  lanca(() => estados.aprovar(pedidoEm("cancelada", "nao_aplicavel"), "carlos", AGORA), "TRANSICAO_INVALIDA");
});

test("estados: recusar exige motivo de 10+ caracteres, aceita sugestao valida", () => {
  const p = Object.freeze(pedidoEm("pendente", "nao_aplicavel"));
  const novo = estados.recusar(p, "carlos", AGORA, {
    motivoDecisao: "  Equipe no limite nessa semana  ",
    sugestao: { inicio: "2026-11-16", fim: "2026-11-20" },
  });
  assert.equal(novo.status, "recusada");
  assert.equal(novo.sincronizacao, "nao_aplicavel");
  assert.equal(novo.motivoDecisao, "Equipe no limite nessa semana");
  assert.deepEqual(novo.sugestao, { inicio: "2026-11-16", fim: "2026-11-20" });
  assert.equal(novo.decididoPor, "carlos");
  assert.equal(estados.recusar(p, "carlos", AGORA, { motivoDecisao: "1234567890" }).status, "recusada"); // 10 chars
  assert.equal("sugestao" in estados.recusar(p, "carlos", AGORA, { motivoDecisao: "1234567890" }), false);
  lanca(() => estados.recusar(p, "carlos", AGORA, { motivoDecisao: "123456789" }), "JUSTIFICATIVA_OBRIGATORIA"); // 9
  lanca(() => estados.recusar(p, "carlos", AGORA, { motivoDecisao: "         x         " }), "JUSTIFICATIVA_OBRIGATORIA");
  lanca(() => estados.recusar(p, "carlos", AGORA, {} as never), "JUSTIFICATIVA_OBRIGATORIA");
  lanca(() => estados.recusar(p, "ana", AGORA, { motivoDecisao: "Motivo suficiente" }), "SEM_PERMISSAO");
  lanca(
    () => estados.recusar(p, "carlos", AGORA, { motivoDecisao: "Motivo suficiente", sugestao: { inicio: "2026-11-20", fim: "2026-11-16" } }),
    "INTERVALO_INVALIDO",
  );
  lanca(() => estados.recusar(pedidoEm("aprovada", "ok"), "carlos", AGORA, { motivoDecisao: "Motivo suficiente" }), "TRANSICAO_INVALIDA");
});

test("estados: cancelar - quem pode e para qual sincronizacao vai", () => {
  const pendente = pedidoEm("pendente", "nao_aplicavel");
  const aprovada = pedidoEm("aprovada", "ok");
  const dono = { id: "ana", papel: "colaborador" as const };
  // Dono antes do inicio.
  const c1 = estados.cancelar(pendente, dono, "2026-11-01");
  assert.deepEqual([c1.status, c1.sincronizacao, c1.canceladoEm, c1.canceladoPor], ["cancelada", "nao_aplicavel", "2026-11-01", "ana"]);
  const c2 = estados.cancelar(aprovada, dono, "2026-10-26");
  assert.deepEqual([c2.status, c2.sincronizacao, c2.canceladoEm], ["cancelada", "remocao_pendente", "2026-10-26"]);
  // Fronteira: no dia do inicio o colaborador ja nao pode (hoje < inicio).
  lanca(() => estados.cancelar(aprovada, dono, "2026-11-02"), "SEM_PERMISSAO");
  lanca(() => estados.cancelar(aprovada, dono, "2026-11-03"), "SEM_PERMISSAO");
  // Gestor ou admin cancelam pedido de outra pessoa mesmo depois do inicio.
  const c3 = estados.cancelar(aprovada, { id: "carlos", papel: "gestor" }, "2026-11-04");
  assert.deepEqual([c3.sincronizacao, c3.canceladoEm, c3.canceladoPor], ["remocao_pendente", "2026-11-04", "carlos"]);
  assert.equal(estados.cancelar(aprovada, { id: "marina", papel: "admin" }, "2026-11-04").status, "cancelada");
  // Colaborador nao cancela pedido alheio; gestor nao cancela o proprio depois do inicio.
  lanca(() => estados.cancelar(aprovada, { id: "bruno", papel: "colaborador" }, "2026-10-26"), "SEM_PERMISSAO");
  const doGestor = ped(8, "carlos", "2026-11-02", "2026-11-06");
  lanca(() => estados.cancelar(doGestor, { id: "carlos", papel: "gestor" }, "2026-11-03"), "SEM_PERMISSAO");
  assert.equal(estados.cancelar(doGestor, { id: "carlos", papel: "gestor" }, "2026-10-30").status, "cancelada");
  // Admin cancela o proprio quando quiser.
  assert.equal(estados.cancelar(ped(9, "marina", "2026-11-02", "2026-11-06"), { id: "marina", papel: "admin" }, "2026-11-03").status, "cancelada");
  // Entradas invalidas e estados terminais.
  lanca(() => estados.cancelar(aprovada, dono, "ontem"), "DATA_INVALIDA");
  lanca(() => estados.cancelar(aprovada, { id: "ana", papel: "root" as never }, "2026-10-26"), "SEM_PERMISSAO");
  lanca(() => estados.cancelar(aprovada, { id: "", papel: "admin" }, "2026-10-26"), "SEM_PERMISSAO");
  lanca(() => estados.cancelar(pedidoEm("recusada", "nao_aplicavel"), { id: "marina", papel: "admin" }, "2026-10-26"), "TRANSICAO_INVALIDA");
  lanca(() => estados.cancelar(pedidoEm("cancelada", "removido"), { id: "marina", papel: "admin" }, "2026-10-26"), "TRANSICAO_INVALIDA");
});

test("estados: ciclo de sincronizacao - 3 tentativas, depois falha_manual (admin retoma)", () => {
  let p: Pedido = pedidoEm("aprovada", "pendente");
  p = estados.iniciarSincronizacao(p, 0);
  assert.equal(p.sincronizacao, "em_andamento");
  p = estados.falharSincronizacao(p, 1);
  assert.equal(p.sincronizacao, "falha");
  p = estados.iniciarSincronizacao(p, 1);
  p = estados.falharSincronizacao(p, 2);
  assert.equal(p.sincronizacao, "falha");
  p = estados.iniciarSincronizacao(p, 2);
  p = estados.falharSincronizacao(p, 3); // 3a falha escala
  assert.equal(p.sincronizacao, "falha_manual");
  assert.equal(p.status, "aprovada");
  lanca(() => estados.iniciarSincronizacao(p, 3), "TRANSICAO_INVALIDA");
  lanca(() => estados.reprocessarManual(p, { id: "carlos", papel: "gestor" }), "SEM_PERMISSAO");
  lanca(() => estados.reprocessarManual(p, { id: "marina", papel: "colaborador" }), "SEM_PERMISSAO");
  p = estados.reprocessarManual(p, { id: "marina", papel: "admin" });
  assert.equal(p.sincronizacao, "em_andamento");
  p = estados.concluirSincronizacao(p);
  assert.equal(p.sincronizacao, "ok");
  // Falha com 3 tentativas ja gravada nao reinicia por iniciarSincronizacao.
  lanca(() => estados.iniciarSincronizacao(pedidoEm("aprovada", "falha"), 3), "TRANSICAO_INVALIDA");
  assert.equal(estados.iniciarSincronizacao(pedidoEm("aprovada", "falha"), 2).sincronizacao, "em_andamento");
});

test("estados: remocao no Bitrix (cancelada) segue remocao_pendente -> em_andamento -> removido|falha", () => {
  const cancelada = estados.cancelar(pedidoEm("aprovada", "ok"), { id: "marina", papel: "admin" }, "2026-10-26");
  const rodando = estados.iniciarSincronizacao(cancelada, 0);
  assert.deepEqual([rodando.status, rodando.sincronizacao], ["cancelada", "em_andamento"]);
  assert.equal(estados.concluirSincronizacao(rodando).sincronizacao, "removido");
  assert.equal(estados.falharSincronizacao(rodando, 1).sincronizacao, "falha");
  assert.equal(estados.falharSincronizacao(rodando, 3).sincronizacao, "falha_manual");
  // Cancelamento de pedido que ainda sincronizava (aprovada/em_andamento) tambem vira remocao_pendente.
  assert.equal(estados.cancelar(pedidoEm("aprovada", "em_andamento"), { id: "marina", papel: "admin" }, "2026-10-26").sincronizacao, "remocao_pendente");
  assert.equal(estados.cancelar(pedidoEm("aprovada", "falha"), { id: "marina", papel: "admin" }, "2026-10-26").sincronizacao, "remocao_pendente");
});

test("estados: sincronizacao fora de ordem lanca", () => {
  lanca(() => estados.concluirSincronizacao(pedidoEm("aprovada", "pendente")), "TRANSICAO_INVALIDA");
  lanca(() => estados.concluirSincronizacao(pedidoEm("pendente", "nao_aplicavel")), "TRANSICAO_INVALIDA");
  lanca(() => estados.iniciarSincronizacao(pedidoEm("pendente", "nao_aplicavel"), 0), "TRANSICAO_INVALIDA");
  lanca(() => estados.iniciarSincronizacao(pedidoEm("aprovada", "ok"), 0), "TRANSICAO_INVALIDA");
  lanca(() => estados.iniciarSincronizacao(pedidoEm("aprovada", "pendente"), -1), "NUMERO_INVALIDO");
  lanca(() => estados.falharSincronizacao(pedidoEm("aprovada", "em_andamento"), Number.NaN), "NUMERO_INVALIDO");
  lanca(() => estados.falharSincronizacao(pedidoEm("aprovada", "ok"), 1), "TRANSICAO_INVALIDA");
  lanca(() => estados.reprocessarManual(pedidoEm("aprovada", "ok"), { id: "marina", papel: "admin" }), "TRANSICAO_INVALIDA");
  lanca(() => estados.validarEstado({ status: "pendente", sincronizacao: "ok" }), "TRANSICAO_INVALIDA");
  assert.deepEqual(estados.validarEstado({ status: "aprovada", sincronizacao: "ok" }), { status: "aprovada", sincronizacao: "ok" });
});

test("estados: intervaloVigente (pendente/aprovada inteiro; cancelada ate canceladoEm-1; recusada nunca)", () => {
  const base = { inicio: "2026-11-02", fim: "2026-11-13" };
  assert.deepEqual(estados.intervaloVigente({ ...base, status: "aprovada" }), base);
  assert.deepEqual(estados.intervaloVigente({ ...base, status: "pendente" }), base);
  assert.equal(estados.intervaloVigente({ ...base, status: "recusada" }), null);
  assert.deepEqual(estados.intervaloVigente({ ...base, status: "cancelada", canceladoEm: "2026-11-06" }), { inicio: "2026-11-02", fim: "2026-11-05" });
  assert.deepEqual(estados.intervaloVigente({ ...base, status: "cancelada", canceladoEm: "2026-11-03" }), { inicio: "2026-11-02", fim: "2026-11-02" });
  assert.equal(estados.intervaloVigente({ ...base, status: "cancelada", canceladoEm: "2026-11-02" }), null);
  assert.equal(estados.intervaloVigente({ ...base, status: "cancelada", canceladoEm: "2026-10-01" }), null);
  assert.deepEqual(estados.intervaloVigente({ ...base, status: "cancelada", canceladoEm: "2026-12-01" }), base);
  lanca(() => estados.intervaloVigente({ ...base, status: "cancelada" }), "DATA_INVALIDA");
  lanca(() => estados.intervaloVigente({ inicio: "2026-11-13", fim: "2026-11-02", status: "aprovada" }), "INTERVALO_INVALIDO");
});

// ------------------------------------------------------------------ cobertura

const SEG = "2026-11-02";
const SEX = "2026-11-06";

test("cobertura: 7 pessoas, minimo 5, 3 ausencias num dia = 1 dia abaixo do minimo", () => {
  const pedidos = [
    ped(1, "ana", "2026-11-03", "2026-11-03"),
    ped(2, "bruno", "2026-11-03", "2026-11-03"),
    ped(3, "camila", "2026-11-03", "2026-11-03"),
  ];
  const dias = pessoasTrabalhandoPorDia(entradaCobertura(pedidos, SEG, SEX));
  assert.deepEqual(dias.map((d) => d.trabalhando), [7, 4, 7, 7, 7]);
  assert.equal(dias[1].total, 7);
  assert.equal(dias[1].ausentes, 3);
  assert.equal(contarDiasAbaixoDoMinimo(dias), 1);
  assert.deepEqual(dias.map((d) => d.abaixoDoMinimo), [false, true, false, false, false]);
  assert.deepEqual(cobertura.piorDia(dias), { data: "2026-11-03", trabalhando: 4 });
});

test("cobertura: no limite (5 de 5) nao esta abaixo; 1 a menos esta", () => {
  const dois = [ped(1, "ana", "2026-11-03", "2026-11-03"), ped(2, "bruno", "2026-11-03", "2026-11-03")];
  const noLimite = pessoasTrabalhandoPorDia(entradaCobertura(dois, SEG, SEX));
  assert.equal(noLimite[1].trabalhando, 5);
  assert.equal(contarDiasAbaixoDoMinimo(noLimite), 0);
  const tres = [...dois, ped(3, "camila", "2026-11-03", "2026-11-03")];
  assert.equal(contarDiasAbaixoDoMinimo(pessoasTrabalhandoPorDia(entradaCobertura(tres, SEG, SEX))), 1);
});

test("cobertura: contarPendentes liga/desliga o peso dos pedidos pendentes", () => {
  const pedidos = [
    ped(1, "ana", "2026-11-03", "2026-11-03"),
    ped(2, "bruno", "2026-11-03", "2026-11-03"),
    ped(3, "camila", "2026-11-03", "2026-11-03", { status: "pendente", sincronizacao: "nao_aplicavel" }),
  ];
  const sem = pessoasTrabalhandoPorDia(entradaCobertura(pedidos, SEG, SEX, { ...EQUIPE_TEC, contarPendentes: false }));
  const com = pessoasTrabalhandoPorDia(entradaCobertura(pedidos, SEG, SEX, { ...EQUIPE_TEC, contarPendentes: true }));
  assert.equal(sem[1].trabalhando, 5);
  assert.equal(com[1].trabalhando, 4);
  assert.equal(contarDiasAbaixoDoMinimo(sem), 0);
  assert.equal(contarDiasAbaixoDoMinimo(com), 1);
});

test("cobertura: so dias uteis - fim de semana e feriado nunca ficam abaixo do minimo", () => {
  // 3 ausentes de sex 6/11 a seg 9/11: sabado e domingo tem 4 trabalhando mas nao contam.
  const pedidos = ["ana", "bruno", "camila"].map((p, i) => ped(i + 1, p, "2026-11-06", "2026-11-09"));
  const dias = pessoasTrabalhandoPorDia(entradaCobertura(pedidos, "2026-11-06", "2026-11-09"));
  assert.deepEqual(dias.map((d) => d.util), [true, false, false, true]);
  assert.deepEqual(dias.map((d) => d.abaixoDoMinimo), [true, false, false, true]);
  assert.equal(contarDiasAbaixoDoMinimo(dias), 2);
  const natal = pessoasTrabalhandoPorDia(entradaCobertura([], "2026-12-24", "2026-12-28"));
  assert.deepEqual(natal.map((d) => [d.util, d.feriado]), [[true, false], [false, true], [false, false], [false, false], [true, false]]);
  // pior dia ignora dia nao util mesmo com menos gente.
  assert.deepEqual(cobertura.piorDia(dias), { data: "2026-11-06", trabalhando: 4 });
  assert.equal(cobertura.piorDia(pessoasTrabalhandoPorDia(entradaCobertura([], "2026-11-07", "2026-11-08"))), null);
});

test("cobertura: gestor incluso, outra equipe ignorada, recusada nao conta, mesma pessoa conta uma vez", () => {
  const dias = (pedidos: Pedido[]) => pessoasTrabalhandoPorDia(entradaCobertura(pedidos, SEG, SEG))[0];
  assert.equal(dias([ped(1, "carlos", SEG, SEG)]).trabalhando, 6); // gestor e membro
  assert.equal(dias([ped(1, "marina", SEG, SEG)]).trabalhando, 7); // admin de outra equipe
  assert.equal(dias([ped(1, "ana", SEG, SEG, { status: "recusada", sincronizacao: "nao_aplicavel" })]).trabalhando, 7);
  assert.equal(dias([ped(1, "ana", SEG, SEG), ped(2, "ana", SEG, SEX, { status: "pendente", sincronizacao: "nao_aplicavel" })]).trabalhando, 6);
  const comPendente = pessoasTrabalhandoPorDia(
    entradaCobertura([ped(1, "ana", SEG, SEG), ped(2, "ana", SEG, SEG, { status: "pendente", sincronizacao: "nao_aplicavel" })], SEG, SEG, {
      ...EQUIPE_TEC,
      contarPendentes: true,
    }),
  )[0];
  assert.equal(comPendente.trabalhando, 6);
  assert.equal(dias([ped(1, "ana", SEG, SEG, { sincronizacao: "falha" })]).trabalhando, 6); // aprovada conta mesmo com falha
});

test("cobertura: cancelada conta so antes de canceladoEm", () => {
  const cancelada = (canceladoEm: string, sincronizacao: StatusSincronizacao = "removido") =>
    ped(1, "ana", SEG, SEX, { status: "cancelada", sincronizacao, canceladoEm });
  const por = (p: Pedido, equipe: Equipe = EQUIPE_TEC) => pessoasTrabalhandoPorDia(entradaCobertura([p], SEG, SEX, equipe)).map((d) => d.trabalhando);
  assert.deepEqual(por(cancelada("2026-11-04")), [6, 6, 7, 7, 7]); // 02 e 03 ja passaram
  assert.deepEqual(por(cancelada("2026-11-02")), [7, 7, 7, 7, 7]);
  assert.deepEqual(por(cancelada("2026-11-07")), [6, 6, 6, 6, 6]);
  // Nunca aprovada (cancelada a partir de pendente) so pesa com contarPendentes.
  assert.deepEqual(por(cancelada("2026-11-04", "nao_aplicavel")), [7, 7, 7, 7, 7]);
  assert.deepEqual(por(cancelada("2026-11-04", "nao_aplicavel"), { ...EQUIPE_TEC, contarPendentes: true }), [6, 6, 7, 7, 7]);
});

test("cobertura: piorDiaPorSemana sem e com pedido (seg-dom, so dias uteis)", () => {
  const existentes = [ped(1, "ana", "2026-11-04", "2026-11-04"), ped(2, "bruno", "2026-11-04", "2026-11-04"), ped(3, "camila", "2026-11-11", "2026-11-11")];
  const entrada = entradaCobertura(existentes, "2026-11-02", "2026-11-15");
  const semPedido = piorDiaPorSemana(entrada);
  assert.deepEqual(
    semPedido.map((s) => [s.semanaInicio, s.semPedido, s.comPedido, s.diaSemPedido]),
    [
      ["2026-11-02", 5, 5, "2026-11-04"],
      ["2026-11-09", 6, 6, "2026-11-11"],
    ],
  );
  // Diego pede quarta e quinta de cada semana: 4 em 04/11 (abaixo), 5 em 11/11.
  const comPedido = piorDiaPorSemana(entrada, { pessoaId: "diego", inicio: "2026-11-04", fim: "2026-11-05" });
  assert.deepEqual(comPedido.map((s) => [s.semPedido, s.comPedido, s.diaComPedido]), [
    [5, 4, "2026-11-04"],
    [6, 6, "2026-11-11"],
  ]);
  const duas = piorDiaPorSemana(entrada, { pessoaId: "diego", inicio: "2026-11-11", fim: "2026-11-12" });
  assert.deepEqual(duas.map((s) => s.comPedido), [5, 5]);
  // Quem ja esta ausente no dia nao e contado duas vezes.
  const repetido = piorDiaPorSemana(entrada, { pessoaId: "ana", inicio: "2026-11-04", fim: "2026-11-04" });
  assert.deepEqual(repetido.map((s) => s.comPedido), [5, 6]);
  // Semana so com fim de semana nao aparece; semana parcial usa so os dias do intervalo.
  assert.deepEqual(piorDiaPorSemana(entradaCobertura([], "2026-11-07", "2026-11-08")), []);
  const parcial = piorDiaPorSemana(entradaCobertura(existentes, "2026-11-05", "2026-11-13"));
  assert.deepEqual(parcial.map((s) => [s.semanaInicio, s.semPedido]), [["2026-11-02", 7], ["2026-11-09", 6]]);
  lanca(() => piorDiaPorSemana(entrada, { pessoaId: "marina", inicio: "2026-11-04", fim: "2026-11-04" }), "NAO_ENCONTRADO");
});

test("cobertura: haConflitoDeEquipe informa mas e so um booleano (nunca bloqueia)", () => {
  const dois = [ped(1, "ana", "2026-11-04", "2026-11-04"), ped(2, "bruno", "2026-11-04", "2026-11-04")];
  const base = { equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, cal: CAL };
  assert.equal(haConflitoDeEquipe({ ...base, pedidos: dois }, { pessoaId: "camila", inicio: "2026-11-04", fim: "2026-11-05" }), true); // 7-3=4
  assert.equal(haConflitoDeEquipe({ ...base, pedidos: dois }, { pessoaId: "camila", inicio: "2026-11-05", fim: "2026-11-06" }), false); // 7-1=6
  assert.equal(haConflitoDeEquipe({ ...base, pedidos: dois.slice(0, 1) }, { pessoaId: "camila", inicio: "2026-11-04", fim: "2026-11-04" }), false); // 7-2=5 no limite
});

test("cobertura: verificarSobreposicao (so dia util, so pendente|aprovada, so a propria pessoa)", () => {
  const existente = ped(1, "ana", "2026-11-02", "2026-11-06");
  const checar = (inicio: string, fim: string, extra: Partial<Parameters<typeof verificarSobreposicao>[0]> = {}) =>
    verificarSobreposicao({ pedidos: [existente], pessoaId: "ana", inicio, fim, cal: CAL, ...extra });
  lanca(() => checar("2026-11-06", "2026-11-10"), "SOBREPOSICAO"); // divide a sexta
  lanca(() => checar("2026-10-30", "2026-11-02"), "SOBREPOSICAO"); // divide a segunda
  lanca(() => checar("2026-11-03", "2026-11-04"), "SOBREPOSICAO");
  assert.doesNotThrow(() => checar("2026-11-07", "2026-11-08")); // so fim de semana
  assert.doesNotThrow(() => checar("2026-11-09", "2026-11-10"));
  assert.doesNotThrow(() => checar("2026-11-03", "2026-11-04", { pessoaId: "bruno" }));
  assert.doesNotThrow(() => checar("2026-11-03", "2026-11-04", { ignorarPedidoId: 1 }));
  for (const status of ["recusada", "cancelada"] as const) {
    assert.doesNotThrow(() =>
      verificarSobreposicao({
        pedidos: [ped(1, "ana", "2026-11-02", "2026-11-06", { status, sincronizacao: "nao_aplicavel", canceladoEm: "2026-11-02" })],
        pessoaId: "ana",
        inicio: "2026-11-03",
        fim: "2026-11-04",
        cal: CAL,
      }),
    );
  }
  assert.doesNotThrow(() =>
    verificarSobreposicao({
      pedidos: [ped(1, "ana", "2026-11-02", "2026-11-06", { status: "pendente", sincronizacao: "nao_aplicavel" })].slice(1),
      pessoaId: "ana",
      inicio: "2026-11-03",
      fim: "2026-11-04",
      cal: CAL,
    }),
  );
  lanca(
    () =>
      verificarSobreposicao({
        pedidos: [ped(1, "ana", "2026-11-02", "2026-11-06", { status: "pendente", sincronizacao: "nao_aplicavel" })],
        pessoaId: "ana",
        inicio: "2026-11-03",
        fim: "2026-11-04",
        cal: CAL,
      }),
    "SOBREPOSICAO",
  );
});

test("cobertura: entrada invalida lanca", () => {
  const ok = entradaCobertura([], SEG, SEX);
  lanca(() => pessoasTrabalhandoPorDia({ ...ok, de: SEX, ate: SEG }), "INTERVALO_INVALIDO");
  lanca(() => pessoasTrabalhandoPorDia({ ...ok, de: "abc" }), "DATA_INVALIDA");
  lanca(() => pessoasTrabalhandoPorDia({ ...ok, de: "2026-01-01", ate: "2027-06-30" }), "INTERVALO_LONGO");
  lanca(() => pessoasTrabalhandoPorDia({ ...ok, equipe: { ...EQUIPE_TEC, minimoPessoas: 0 } }), "NUMERO_INVALIDO");
  lanca(() => pessoasTrabalhandoPorDia({ ...ok, equipe: { ...EQUIPE_TEC, minimoPessoas: 2.5 } }), "NUMERO_INVALIDO");
  lanca(() => pessoasTrabalhandoPorDia({ ...ok, equipe: { ...EQUIPE_TEC, contarPendentes: "sim" as never } }), "NUMERO_INVALIDO");
  lanca(() => cobertura.membrosDaEquipe(EQUIPE_TEC, null as never), "NAO_ENCONTRADO");
  lanca(() => cobertura.intervaloQueConta(ped(1, "ana", SEG, SEX), "sim" as never), "NUMERO_INVALIDO");
  lanca(() => cobertura.contarDiasAbaixoDoMinimo(null as never), "NUMERO_INVALIDO");
  lanca(() => cobertura.piorDia(null as never), "NUMERO_INVALIDO");
  lanca(() => haConflitoDeEquipe({ equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos: [], cal: CAL }, { pessoaId: "ana", inicio: SEX, fim: SEG }), "INTERVALO_INVALIDO");
  lanca(() => verificarSobreposicao({ pedidos: [], pessoaId: "ana", inicio: "abc", fim: SEG, cal: CAL }), "DATA_INVALIDA");
  assert.equal(cobertura.membrosDaEquipe(EQUIPE_TEC, TODAS_PESSOAS).length, 7);
  assert.equal(cobertura.intervaloQueConta(ped(1, "ana", SEG, SEX, { status: "recusada", sincronizacao: "nao_aplicavel" }), true), null);
});

// ------------------------------------------------------------------ janela

test("janela: ate 3 janelas ordenadas por maior minimo e depois inicio", () => {
  const pedidos = [
    ped(1, "ana", "2026-10-27", "2026-11-10"), // sai por duas semanas
    ped(2, "bruno", "2026-10-29", "2026-10-30"),
    ped(3, "camila", "2026-11-04", "2026-11-04"),
  ];
  const r = melhorJanela({ n: 2, equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos, cal: CAL, hoje: HOJE });
  // Janelas antes de 11/11 tem no maximo 6 trabalhando; a partir de 11/11 todos (7).
  assert.deepEqual(r, [
    { inicio: "2026-11-11", fim: "2026-11-12", minTrabalhando: 7, diasUteis: 2 },
    { inicio: "2026-11-12", fim: "2026-11-13", minTrabalhando: 7, diasUteis: 2 },
    { inicio: "2026-11-13", fim: "2026-11-16", minTrabalhando: 7, diasUteis: 2 }, // atravessa o fim de semana
  ]);
});

test("janela: respeita o minimo em todos os dias e nao propoe dias abaixo dele", () => {
  const pedidos = ["ana", "bruno", "camila"].map((p, i) => ped(i + 1, p, "2026-10-27", "2026-10-29"));
  const r = melhorJanela({ n: 2, equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos, cal: CAL, hoje: HOJE });
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { inicio: "2026-10-30", fim: "2026-11-02", minTrabalhando: 7, diasUteis: 2 });
  for (const j of r) assert.ok(j.inicio > "2026-10-29");
  // Um dia no limite (5) ainda serve; 4 nao.
  const doisFora = ["ana", "bruno"].map((p, i) => ped(i + 1, p, "2026-10-27", "2026-10-27"));
  const tres = melhorJanela({ n: 1, equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos: doisFora, cal: CAL, hoje: HOJE });
  assert.deepEqual(tres.map((j) => j.minTrabalhando), [7, 7, 7]);
  const todos5 = melhorJanela({
    n: 1,
    equipe: { ...EQUIPE_TEC, minimoPessoas: 7 },
    pessoas: TODAS_PESSOAS,
    pedidos: doisFora,
    cal: CAL,
    hoje: HOJE,
  });
  assert.ok(todos5.every((j) => j.inicio !== "2026-10-27")); // 5 < 7
});

test("janela: no limite exato (5 de 5 trabalhando) a janela serve; com 4 nao", () => {
  const fora = (pessoas: string[]) => pessoas.map((p, i) => ped(i + 1, p, "2026-10-27", "2027-04-25")); // todo o horizonte
  const base = { n: 2, equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, cal: CAL, hoje: HOJE };
  const noLimite = melhorJanela({ ...base, pedidos: fora(["ana", "bruno"]) });
  assert.deepEqual(noLimite[0], { inicio: "2026-10-27", fim: "2026-10-28", minTrabalhando: 5, diasUteis: 2 });
  assert.equal(noLimite.length, 3);
  assert.deepEqual(melhorJanela({ ...base, pedidos: fora(["ana", "bruno", "camila"]) }), []);
});

test("janela: janelas comecam amanha, cabem em 180 dias e nao existem se n nao cabe", () => {
  const base = { equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos: [], cal: CAL, hoje: HOJE };
  assert.equal(melhorJanela({ ...base, n: 1 })[0].inicio, "2026-10-27"); // amanha, nunca hoje
  assert.equal(melhorJanela({ ...base, n: 180 }).length, 0); // 180 dias uteis nao cabem em 180 dias corridos
  const uteisNoHorizonte = contarDiasUteis("2026-10-27", somarDias(HOJE, 180), CAL);
  assert.equal(melhorJanela({ ...base, n: uteisNoHorizonte }).length, 1); // a janela inteira cabe uma vez
  assert.equal(melhorJanela({ ...base, n: uteisNoHorizonte + 1 }).length, 0); // um dia util a mais nao cabe
  assert.ok(melhorJanela({ ...base, n: 100 }).length >= 1);
  const ultimo = melhorJanela({ ...base, n: 1, hoje: "2026-10-26" });
  assert.ok(ultimo.every((j) => j.fim <= somarDias("2026-10-26", 180)));
});

test("janela: com solicitante desconta 1 ausente e descarta janelas que colidem com pedido dele", () => {
  const pedidos = [
    ped(1, "ana", "2026-10-27", "2026-11-10"),
    ped(2, "diego", "2026-11-11", "2026-11-12", { status: "pendente", sincronizacao: "nao_aplicavel" }),
  ];
  const r = melhorJanela({ n: 2, equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos, cal: CAL, hoje: HOJE, pessoaId: "diego" });
  assert.deepEqual(r[0], { inicio: "2026-11-13", fim: "2026-11-16", minTrabalhando: 6, diasUteis: 2 });
  for (const j of r) assert.ok(j.fim < "2026-11-11" || j.inicio > "2026-11-12");
  lanca(() => melhorJanela({ n: 2, equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos, cal: CAL, hoje: HOJE, pessoaId: "marina" }), "NAO_ENCONTRADO");
});

test("janela: entrada invalida lanca", () => {
  const base = { equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos: [], cal: CAL, hoje: HOJE };
  lanca(() => melhorJanela({ ...base, n: 0 }), "NUMERO_INVALIDO");
  lanca(() => melhorJanela({ ...base, n: -1 }), "NUMERO_INVALIDO");
  lanca(() => melhorJanela({ ...base, n: 1.5 }), "NUMERO_INVALIDO");
  lanca(() => melhorJanela({ ...base, n: Number.POSITIVE_INFINITY }), "NUMERO_INVALIDO");
  lanca(() => melhorJanela({ ...base, n: 181 }), "NUMERO_INVALIDO");
  lanca(() => melhorJanela({ ...base, n: 2, hoje: "abc" }), "DATA_INVALIDA");
});

// ------------------------------------------------------------------ indicadores

const AGORA_PAINEL = "2026-10-27T12:00:00.000Z";
const HOJE_PAINEL = "2026-10-27"; // terca; +90 dias = 2027-01-25 (segunda)

function cenarioPainel(): Pedido[] {
  const dec = (extra: Partial<Pedido>) => ({ ...extra });
  return [
    ped(1, "ana", "2026-11-02", "2026-11-06", dec({ criadoEm: "2026-10-20T12:00:00.000Z", decididoEm: "2026-10-21T12:00:00.000Z", decididoPor: "carlos" })),
    ped(2, "bruno", "2026-11-03", "2026-11-04", dec({ tipoId: "viagem", criadoEm: "2026-10-20T00:00:00.000Z", decididoEm: "2026-10-20T12:00:00.000Z", decididoPor: "carlos" })),
    ped(3, "camila", "2026-11-03", "2026-11-03", { status: "pendente", sincronizacao: "nao_aplicavel", prazoEm: "2026-10-27T11:59:59.000Z" }),
    ped(4, "diego", "2026-11-03", "2026-11-03", { status: "pendente", sincronizacao: "nao_aplicavel", prazoEm: AGORA_PAINEL }),
    ped(5, "elisa", "2026-11-09", "2026-11-09", {
      status: "recusada",
      sincronizacao: "nao_aplicavel",
      criadoEm: "2026-10-20T00:00:00.000Z",
      decididoEm: "2026-10-22T00:00:00.000Z",
      decididoPor: "carlos",
      motivoDecisao: "Equipe no limite nessa semana",
    }),
    ped(6, "felipe", "2026-11-09", "2026-11-13", {
      status: "cancelada",
      sincronizacao: "removido",
      canceladoEm: "2026-10-25",
      criadoEm: "2026-10-19T12:00:00.000Z",
      decididoEm: "2026-10-20T12:00:00.000Z",
      decididoPor: "carlos",
    }),
  ];
}

function entradaPainel(pedidos: Pedido[], extra: Partial<indicadoresMod.EntradaIndicadores> = {}): indicadoresMod.EntradaIndicadores {
  return {
    escopo: "equipe",
    equipeId: "tec",
    equipes: [EQUIPE_TEC],
    pessoas: TODAS_PESSOAS,
    pedidos,
    tipos: TIPOS,
    lancamentos: [],
    cal: CAL,
    hoje: HOJE_PAINEL,
    agora: AGORA_PAINEL,
    ...extra,
  };
}

test("indicadores: por status, aguardando/atrasados (fronteira do prazo), taxa e tempo medio", () => {
  const r = indicadores(entradaPainel(cenarioPainel()));
  assert.equal(r.escopo, "equipe");
  assert.deepEqual(r.porStatus, { pendente: 2, aprovada: 2, recusada: 1, cancelada: 1 });
  // prazo 11:59:59 < agora = atrasado; prazo == agora nao e.
  assert.deepEqual(r.aguardandoGestor, { total: 2, atrasados: 1 });
  // aprovados = 2 aprovadas + 1 cancelada que ja fora decidida = 3; recusados = 1.
  assert.equal(r.taxaAprovacao, 0.75);
  // decisoes: 24h, 12h, 48h, 24h
  assert.equal(r.tempoMedioDecisaoHoras, 27);
});

test("indicadores: sem decisoes, taxa e tempo medio sao null e as chaves de status existem", () => {
  const r = indicadores(entradaPainel([]));
  assert.deepEqual(r.porStatus, { pendente: 0, aprovada: 0, recusada: 0, cancelada: 0 });
  assert.equal(r.taxaAprovacao, null);
  assert.equal(r.tempoMedioDecisaoHoras, null);
  assert.deepEqual(r.aguardandoGestor, { total: 0, atrasados: 0 });
  assert.deepEqual(r.diasPorTipo, []);
  assert.deepEqual(r.feriasVencendo, []);
  assert.deepEqual(r.diasAbaixoDoMinimoPorEquipe, [{ equipeId: "tec", nome: "Tecnologia", dias: 0 }]);
  const soPendente = indicadores(entradaPainel([ped(1, "ana", SEG, SEX, { status: "pendente", sincronizacao: "nao_aplicavel" })]));
  assert.equal(soPendente.taxaAprovacao, null);
  const soRecusa = indicadores(
    entradaPainel([ped(1, "ana", SEG, SEX, { status: "recusada", sincronizacao: "nao_aplicavel", decididoEm: "2026-10-21T12:00:00.000Z" })]),
  );
  assert.equal(soRecusa.taxaAprovacao, 0);
  assert.equal(soRecusa.tempoMedioDecisaoHoras, 24);
});

test("indicadores: dias por tipo nos proximos 90 dias (dias uteis, pendente e cancelada nao entram)", () => {
  const r = indicadores(entradaPainel(cenarioPainel()));
  assert.deepEqual(r.diasPorTipo, [
    { rotulo: "Férias anuais", dias: 5 },
    { rotulo: "Viagem de negócios", dias: 2 },
  ]);
});

test("indicadores: horizonte de 90 dias e inclusivo (hoje..hoje+90)", () => {
  const unico = (id: number, dia: string) => ped(id, "ana", dia, dia);
  const dentro = indicadores(entradaPainel([unico(1, "2027-01-25")]));
  assert.deepEqual(dentro.diasPorTipo, [{ rotulo: "Férias anuais", dias: 1 }]);
  const fora = indicadores(entradaPainel([unico(1, "2027-01-26")]));
  assert.deepEqual(fora.diasPorTipo, []);
  const hojeMesmo = indicadores(entradaPainel([unico(1, HOJE_PAINEL)]));
  assert.deepEqual(hojeMesmo.diasPorTipo, [{ rotulo: "Férias anuais", dias: 1 }]);
  const ontem = indicadores(entradaPainel([unico(1, "2026-10-26")]));
  assert.deepEqual(ontem.diasPorTipo, []);
  // Pedido que atravessa a borda conta so os dias dentro do horizonte.
  const cruza = indicadores(entradaPainel([ped(1, "ana", "2027-01-22", "2027-01-29")]));
  assert.deepEqual(cruza.diasPorTipo, [{ rotulo: "Férias anuais", dias: 2 }]); // 22 (sex) e 25 (seg)
});

test("indicadores: tipos sensiveis agregam como 'Ausências' e somem com menos de 3 pessoas", () => {
  const sens = (id: number, pessoa: string, tipoId: string, inicio: string, fim: string) => ped(id, pessoa, inicio, fim, { tipoId });
  const duas = [
    ...cenarioPainel(),
    sens(10, "ana", "doenca", "2026-11-09", "2026-11-10"),
    sens(11, "bruno", "maternidade", "2026-11-09", "2026-11-09"),
  ];
  const r2 = indicadores(entradaPainel(duas));
  assert.equal(r2.diasPorTipo.some((t) => t.rotulo === "Ausências"), false); // n = 2 -> suprimido
  assert.equal(JSON.stringify(r2.diasPorTipo).includes("doença"), false);
  const tres = [...duas, sens(12, "camila", "doenca", "2026-11-12", "2026-11-13")];
  const r3 = indicadores(entradaPainel(tres));
  assert.deepEqual(r3.diasPorTipo.find((t) => t.rotulo === "Ausências"), { rotulo: "Ausências", dias: 5 });
  const texto = JSON.stringify(r3.diasPorTipo);
  for (const proibido of ["doença", "maternidade", "Licença", "Licenças"]) assert.equal(texto.includes(proibido), false, proibido);
  // 3 pedidos da MESMA pessoa continuam n = 1.
  const mesma = indicadores(
    entradaPainel([
      sens(10, "ana", "doenca", "2026-11-02", "2026-11-02"),
      sens(11, "ana", "doenca", "2026-11-03", "2026-11-03"),
      sens(12, "ana", "maternidade", "2026-11-04", "2026-11-04"),
    ]),
  );
  assert.deepEqual(mesma.diasPorTipo, []);
  assert.equal(indicadoresMod.SUPRESSAO_MINIMA, 3);
  assert.equal(indicadoresMod.ROTULO_AGREGADO_SENSIVEL, "Ausências");
});

test("indicadores: ferias vencendo (fronteira de 90 dias, vencido e FIFO)", () => {
  const lanc = [
    cred(1, 20, { pessoaId: "ana", venceEm: "2027-01-25" }), // hoje+90: entra
    cred(2, 5, { pessoaId: "bruno", venceEm: "2027-01-26" }), // hoje+91: nao
    cred(3, 5, { pessoaId: "camila", venceEm: "2026-10-26" }), // ja venceu
    cred(4, 5, { pessoaId: "diego" }), // sem vencimento
    cred(5, 4, { pessoaId: "elisa", venceEm: "2026-10-27" }), // vence hoje: entra
    cred(6, 3, { pessoaId: "felipe", venceEm: "2026-12-31", carteira: "folga" }), // outra carteira
  ];
  const r = indicadores(entradaPainel(cenarioPainel(), { lancamentos: lanc }));
  // Ana ja tem 5 dias de ferias aprovados (FIFO do mesmo lote): sobram 15.
  assert.deepEqual(r.feriasVencendo, [
    { pessoa: { id: "elisa", nome: "Elisa Prado", equipeId: "tec", papel: "colaborador", funcao: "QA" }, dias: 4, venceEm: "2026-10-27" },
    { pessoa: { id: "ana", nome: "Ana Ribeiro", equipeId: "tec", papel: "colaborador", funcao: "Back-end" }, dias: 15, venceEm: "2027-01-25" },
  ]);
});

test("indicadores: dias abaixo do minimo por equipe respeitam contarPendentes", () => {
  const pedidos = cenarioPainel(); // 03/11: ana e bruno aprovados; camila e diego pendentes
  const sem = indicadores(entradaPainel(pedidos));
  assert.deepEqual(sem.diasAbaixoDoMinimoPorEquipe, [{ equipeId: "tec", nome: "Tecnologia", dias: 0 }]); // 5 de 7
  const equipeCom = { ...EQUIPE_TEC, contarPendentes: true };
  const com = indicadores(entradaPainel(pedidos, { equipes: [equipeCom] }));
  assert.deepEqual(com.diasAbaixoDoMinimoPorEquipe, [{ equipeId: "tec", nome: "Tecnologia", dias: 1 }]); // 3 de 7
});

test("indicadores: escopo empresa ve todas as equipes; escopo equipe filtra", () => {
  const people: Equipe = { id: "people", nome: "People", gestorId: "marina", minimoPessoas: 1, contarPendentes: false };
  const pedidos = [...cenarioPainel(), ped(20, "marina", "2026-11-02", "2026-11-02", { status: "pendente", sincronizacao: "nao_aplicavel" })];
  const empresa = indicadores(entradaPainel(pedidos, { escopo: "empresa", equipeId: undefined, equipes: [EQUIPE_TEC, people] }));
  assert.equal(empresa.escopo, "empresa");
  assert.equal(empresa.porStatus.pendente, 3);
  assert.deepEqual(empresa.diasAbaixoDoMinimoPorEquipe.map((e) => e.equipeId), ["tec", "people"]);
  const equipe = indicadores(entradaPainel(pedidos, { equipes: [EQUIPE_TEC, people] }));
  assert.equal(equipe.porStatus.pendente, 2);
  assert.deepEqual(equipe.diasAbaixoDoMinimoPorEquipe.map((e) => e.equipeId), ["tec"]);
});

test("indicadores: entrada invalida lanca", () => {
  const ok = entradaPainel([]);
  lanca(() => indicadores({ ...ok, hoje: "abc" }), "DATA_INVALIDA");
  lanca(() => indicadores({ ...ok, agora: "2026-10-27" }), "DATA_INVALIDA");
  lanca(() => indicadores({ ...ok, equipeId: undefined }), "NAO_ENCONTRADO");
  lanca(() => indicadores({ ...ok, equipeId: "nao-existe" }), "NAO_ENCONTRADO");
  lanca(() => indicadores({ ...ok, escopo: "global" as never }), "NAO_ENCONTRADO");
  lanca(
    () => indicadores(entradaPainel([ped(1, "ana", SEG, SEX, { tipoId: "inexistente" })])),
    "NAO_ENCONTRADO",
  );
  lanca(
    () =>
      indicadores(
        entradaPainel([ped(1, "ana", SEG, SEX, { criadoEm: "2026-10-22T00:00:00.000Z", decididoEm: "2026-10-21T00:00:00.000Z" })]),
      ),
    "INTERVALO_INVALIDO",
  );
});

// ------------------------------------------------------------------ cobertura de entrada invalida

type Chamada = [() => unknown, SubcodigoDominio | "false"];
const PEDIDO_ESTADO = pedidoEm("aprovada", "em_andamento");

/** Toda funcao exportada precisa de ao menos um caso invalido (predicados devolvem false). */
const INVALIDOS: Record<string, Record<string, Chamada>> = {
  datas: {
    ehDataISO: [() => ehDataISO("abc"), "false"],
    validarData: [() => datas.validarData("abc"), "DATA_INVALIDA"],
    validarIntervalo: [() => datas.validarIntervalo("2026-02-01", "2026-01-01"), "INTERVALO_INVALIDO"],
    paraDate: [() => datas.paraDate("abc"), "DATA_INVALIDA"],
    deDate: [() => datas.deDate(new Date(Number.NaN)), "DATA_INVALIDA"],
    somarDias: [() => somarDias("2026-01-01", Number.NaN), "NUMERO_INVALIDO"],
    somarAnos: [() => somarAnos("2026-01-01", 0.5), "NUMERO_INVALIDO"],
    diaDaSemana: [() => datas.diaDaSemana("abc"), "DATA_INVALIDA"],
    inicioDaSemana: [() => datas.inicioDaSemana("2026-02-30"), "DATA_INVALIDA"],
    anoDe: [() => datas.anoDe("2026-13-01"), "DATA_INVALIDA"],
    diasEntre: [() => datas.diasEntre("2026-02-01", "2026-01-01"), "INTERVALO_INVALIDO"],
    intervaloInclusivo: [() => intervaloInclusivo("2026-01-01", "2030-01-01"), "INTERVALO_LONGO"],
    sobrepoe: [() => sobrepoe({ inicio: "abc", fim: "2026-01-01" }, { inicio: "2026-01-01", fim: "2026-01-01" }), "DATA_INVALIDA"],
    ehInstanteISO: [() => ehInstanteISO("2026-10-26"), "false"],
    validarInstante: [() => datas.validarInstante("2026-10-26"), "DATA_INVALIDA"],
    instanteParaMs: [() => datas.instanteParaMs("x"), "DATA_INVALIDA"],
    compararInstantes: [() => datas.compararInstantes("x", AGORA), "DATA_INVALIDA"],
    somarHoras: [() => datas.somarHoras(AGORA, Number.POSITIVE_INFINITY), "NUMERO_INVALIDO"],
    horasEntre: [() => datas.horasEntre(AGORA, "x"), "DATA_INVALIDA"],
  },
  "dias-uteis": {
    calendarioDoPortal: [() => calendarioDoPortal({ diasNaoUteis: ["XX"], feriados: [], excecoesTrabalhadas: [] }), "DATA_INVALIDA"],
    ehFeriado: [() => ehFeriado("abc", CAL), "DATA_INVALIDA"],
    ehDiaUtil: [() => ehDiaUtil("2026-02-30", CAL), "DATA_INVALIDA"],
    diasUteisEntre: [() => diasUteisEntre("abc", "2026-01-01", CAL), "DATA_INVALIDA"],
    contarDiasUteis: [() => contarDiasUteis("2026-02-01", "2026-01-01", CAL), "INTERVALO_INVALIDO"],
    avisosDeConfiguracao: [() => diasUteis.avisosDeConfiguracao({} as never), "DATA_INVALIDA"],
  },
  saldo: {
    diasDebitoPorAno: [() => diasDebitoPorAno("abc", "abc", CAL), "DATA_INVALIDA"],
    totalDebito: [() => saldoMod.totalDebito({ x: 1 }), "NUMERO_INVALIDO"],
    saldo: [() => saldo({ ...entradaSaldo([], []), hoje: "abc" }), "DATA_INVALIDA"],
    simularPedido: [() => simularPedido({ ...entradaSaldo([], []), tipoId: "x", inicio: SEG, fim: SEX }), "NAO_ENCONTRADO"],
  },
  estados: {
    estadoValido: [() => estados.estadoValido({ status: "x" as never, sincronizacao: "ok" }), "false"],
    validarEstado: [() => estados.validarEstado({ status: "pendente", sincronizacao: "ok" }), "TRANSICAO_INVALIDA"],
    transicaoPermitida: [() => estados.transicaoPermitida({ status: "pendente", sincronizacao: "ok" }, { status: "aprovada", sincronizacao: "ok" }), "false"],
    mudarEstado: [() => estados.mudarEstado(PEDIDO_ESTADO, { status: "pendente", sincronizacao: "nao_aplicavel" }), "TRANSICAO_INVALIDA"],
    aprovar: [() => estados.aprovar(PEDIDO_ESTADO, "carlos", AGORA), "TRANSICAO_INVALIDA"],
    recusar: [() => estados.recusar(PEDIDO_ESTADO, "carlos", AGORA, { motivoDecisao: "Motivo suficiente" }), "TRANSICAO_INVALIDA"],
    cancelar: [() => estados.cancelar(PEDIDO_ESTADO, { id: "", papel: "admin" }, HOJE), "SEM_PERMISSAO"],
    iniciarSincronizacao: [() => estados.iniciarSincronizacao(PEDIDO_ESTADO, -1), "NUMERO_INVALIDO"],
    concluirSincronizacao: [() => estados.concluirSincronizacao(pedidoEm("aprovada", "ok")), "TRANSICAO_INVALIDA"],
    falharSincronizacao: [() => estados.falharSincronizacao(PEDIDO_ESTADO, Number.NaN), "NUMERO_INVALIDO"],
    reprocessarManual: [() => estados.reprocessarManual(PEDIDO_ESTADO, { id: "marina", papel: "admin" }), "TRANSICAO_INVALIDA"],
    intervaloVigente: [() => estados.intervaloVigente({ status: "cancelada", inicio: SEG, fim: SEX }), "DATA_INVALIDA"],
  },
  cobertura: {
    membrosDaEquipe: [() => cobertura.membrosDaEquipe(EQUIPE_TEC, null as never), "NAO_ENCONTRADO"],
    intervaloQueConta: [() => cobertura.intervaloQueConta(ped(1, "ana", SEG, SEX), null as never), "NUMERO_INVALIDO"],
    pessoasTrabalhandoPorDia: [() => pessoasTrabalhandoPorDia(entradaCobertura([], SEX, SEG)), "INTERVALO_INVALIDO"],
    contarDiasAbaixoDoMinimo: [() => contarDiasAbaixoDoMinimo(null as never), "NUMERO_INVALIDO"],
    piorDia: [() => cobertura.piorDia(null as never), "NUMERO_INVALIDO"],
    piorDiaPorSemana: [() => piorDiaPorSemana(entradaCobertura([], "abc", SEX)), "DATA_INVALIDA"],
    haConflitoDeEquipe: [() => haConflitoDeEquipe({ equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos: [], cal: CAL }, { pessoaId: "ana", inicio: "abc", fim: SEX }), "DATA_INVALIDA"],
    verificarSobreposicao: [() => verificarSobreposicao({ pedidos: [], pessoaId: "ana", inicio: SEX, fim: SEG, cal: CAL }), "INTERVALO_INVALIDO"],
  },
  janela: {
    melhorJanela: [() => melhorJanela({ n: 0, equipe: EQUIPE_TEC, pessoas: TODAS_PESSOAS, pedidos: [], cal: CAL, hoje: HOJE }), "NUMERO_INVALIDO"],
  },
  indicadores: {
    indicadores: [() => indicadores({ ...entradaPainel([]), hoje: "abc" }), "DATA_INVALIDA"],
  },
};

const MODULOS: Record<string, Record<string, unknown>> = {
  datas,
  "dias-uteis": diasUteis,
  saldo: saldoMod,
  estados,
  cobertura,
  janela,
  indicadores: indicadoresMod,
};

test("contrato: toda funcao exportada tem caso invalido (lanca o subcodigo; predicados devolvem false)", () => {
  for (const [modulo, exportados] of Object.entries(MODULOS)) {
    const funcoes = Object.entries(exportados).filter(([, v]) => typeof v === "function").map(([nome]) => nome);
    const cobertas = Object.keys(INVALIDOS[modulo] ?? {});
    assert.deepEqual(
      funcoes.filter((f) => !cobertas.includes(f)).sort(),
      [],
      `${modulo}: funcoes exportadas sem caso invalido`,
    );
    assert.deepEqual(cobertas.filter((c) => !funcoes.includes(c)).sort(), [], `${modulo}: caso invalido para funcao que nao existe`);
    for (const [nome, [chamar, esperado]] of Object.entries(INVALIDOS[modulo])) {
      if (esperado === "false") {
        assert.equal(chamar(), false, `${modulo}.${nome}`);
      } else {
        assert.throws(
          chamar,
          (e: unknown) => e instanceof ErroDominio && e.subcodigo === esperado,
          `${modulo}.${nome} deveria lancar ${esperado}`,
        );
      }
    }
  }
});

test("contrato: ErroDominio nao vaza RangeError/TypeError para quem chama com lixo", () => {
  const lixos: unknown[] = [undefined, null, "", "abc", 0, -1, NaN, Infinity, {}, [], "2026-02-30", "2026-1-1", Symbol.iterator.toString()];
  for (const lixo of lixos) {
    for (const chamar of [
      () => datas.validarData(lixo),
      () => datas.paraDate(lixo as never),
      () => somarDias(lixo as never, 1),
      () => (Number.isInteger(lixo) ? datas.validarData(lixo) : somarDias("2026-01-01", lixo as never)),
      () => intervaloInclusivo(lixo as never, lixo as never),
      () => datas.diasEntre(lixo as never, "2026-01-01"),
      () => ehDiaUtil(lixo as never, CAL),
      () => contarDiasUteis(lixo as never, lixo as never, CAL),
    ]) {
      try {
        chamar();
        assert.fail(`aceitou ${String(lixo)}`);
      } catch (e) {
        assert.ok(e instanceof ErroDominio, `lancou ${String(e)} para ${String(lixo)}`);
      }
    }
  }
});

// ------------------------------------------------------------------ regressao dos lacos

test("regressao: lixo nunca trava nem devolve NaN (subprocesso, timeout 3000 ms, < 100 ms por chamada)", () => {
  // Bugs conhecidos: cicloDaData/dividirPorCiclo com 'abc' travavam (ciclos.ts foi removido do MVP);
  // somarDias(NaN) devolvia '0NaN-NaN-NaN'. Os laços equivalentes de hoje: intervaloInclusivo,
  // diasUteisEntre, diasDebitoPorAno, cobertura e melhorJanela.
  const url = (arquivo: string) => pathToFileURL(path.join(RAIZ, "src/lib/ausencias", arquivo)).href;
  const script = `
    const d = await import(${JSON.stringify(url("datas.ts"))});
    const u = await import(${JSON.stringify(url("dias-uteis.ts"))});
    const s = await import(${JSON.stringify(url("saldo.ts"))});
    const c = await import(${JSON.stringify(url("cobertura.ts"))});
    const j = await import(${JSON.stringify(url("janela.ts"))});
    const i = await import(${JSON.stringify(url("indicadores.ts"))});
    const cal = u.calendarioDoPortal(null);
    const equipe = { id: "t", nome: "T", gestorId: "g", minimoPessoas: 1, contarPendentes: false };
    const base = { equipe, pessoas: [], pedidos: [], cal };
    const casos = {
      intervaloAbcAbc: () => d.intervaloInclusivo("abc", "abc"),
      intervaloAbc: () => d.intervaloInclusivo("abc", "2026-01-01"),
      intervaloFimAbc: () => d.intervaloInclusivo("2026-01-01", "abc"),
      intervaloGigante: () => d.intervaloInclusivo("0000-01-01", "9999-12-31"),
      somarDiasNaN: () => d.somarDias("2026-01-01", NaN),
      somarDiasInf: () => d.somarDias("2026-01-01", Infinity),
      somarDiasNegInf: () => d.somarDias("2026-01-01", -Infinity),
      somarDiasEnorme: () => d.somarDias("2026-01-01", 1e300),
      somarDiasUndefined: () => d.somarDias("2026-01-01", undefined),
      somarAnosNaN: () => d.somarAnos("2026-01-01", NaN),
      diasEntreAbc: () => d.diasEntre("abc", "abc"),
      diasUteisAbc: () => u.diasUteisEntre("abc", "abc", cal),
      diasUteisGigante: () => u.diasUteisEntre("0000-01-01", "9999-12-31", cal),
      contarAbc: () => u.contarDiasUteis("abc", "2026-01-01", cal),
      debitoAbc: () => s.diasDebitoPorAno("abc", "abc", cal),
      debitoGigante: () => s.diasDebitoPorAno("2026-01-01", "9999-12-31", cal),
      saldoHojeAbc: () => s.saldo({ pessoaId: "p", carteira: "ferias", hoje: "abc", lancamentos: [], pedidos: [], tipos: [], cal }),
      coberturaAbc: () => c.pessoasTrabalhandoPorDia({ ...base, de: "abc", ate: "abc" }),
      coberturaGigante: () => c.pessoasTrabalhandoPorDia({ ...base, de: "0000-01-01", ate: "9999-12-31" }),
      semanaAbc: () => c.piorDiaPorSemana({ ...base, de: "abc", ate: "2026-01-01" }),
      janelaNInf: () => j.melhorJanela({ ...base, n: Infinity, hoje: "2026-10-26" }),
      janelaNaN: () => j.melhorJanela({ ...base, n: NaN, hoje: "2026-10-26" }),
      janelaHojeAbc: () => j.melhorJanela({ ...base, n: 2, hoje: "abc" }),
      janelaHojeFim: () => j.melhorJanela({ ...base, n: 2, hoje: "9999-12-31" }),
      painelHojeAbc: () => i.indicadores({ escopo: "empresa", equipes: [], pessoas: [], pedidos: [], tipos: [], lancamentos: [], cal, hoje: "abc", agora: "x" }),
    };
    const saida = {};
    for (const [nome, fn] of Object.entries(casos)) {
      const t0 = process.hrtime.bigint();
      try { const v = fn(); saida[nome] = { devolveu: JSON.stringify(v) }; }
      catch (e) { saida[nome] = { erro: e && e.constructor && e.constructor.name, subcodigo: e && e.subcodigo }; }
      saida[nome].ms = Number(process.hrtime.bigint() - t0) / 1e6;
    }
    console.log(JSON.stringify(saida));
  `;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--import", path.join(RAIZ, "tests/registrar-alias.mjs"), "--input-type=module", "-e", script],
    { timeout: 3000, encoding: "utf8", cwd: RAIZ },
  );
  assert.equal(r.error, undefined, `subprocesso falhou/travou: ${String(r.error)}`);
  assert.equal(r.signal, null);
  assert.equal(r.status, 0, r.stderr);
  const saida = JSON.parse(r.stdout) as Record<string, { erro?: string; subcodigo?: string; devolveu?: string; ms: number }>;
  const esperados: Record<string, string> = {
    intervaloAbcAbc: "DATA_INVALIDA",
    intervaloAbc: "DATA_INVALIDA",
    intervaloFimAbc: "DATA_INVALIDA",
    intervaloGigante: "INTERVALO_LONGO",
    somarDiasNaN: "NUMERO_INVALIDO",
    somarDiasInf: "NUMERO_INVALIDO",
    somarDiasNegInf: "NUMERO_INVALIDO",
    somarDiasEnorme: "DATA_INVALIDA",
    somarDiasUndefined: "NUMERO_INVALIDO",
    somarAnosNaN: "NUMERO_INVALIDO",
    diasEntreAbc: "DATA_INVALIDA",
    diasUteisAbc: "DATA_INVALIDA",
    diasUteisGigante: "INTERVALO_LONGO",
    contarAbc: "DATA_INVALIDA",
    debitoAbc: "DATA_INVALIDA",
    debitoGigante: "INTERVALO_LONGO",
    saldoHojeAbc: "DATA_INVALIDA",
    coberturaAbc: "DATA_INVALIDA",
    coberturaGigante: "INTERVALO_LONGO",
    semanaAbc: "DATA_INVALIDA",
    janelaNInf: "NUMERO_INVALIDO",
    janelaNaN: "NUMERO_INVALIDO",
    janelaHojeAbc: "DATA_INVALIDA",
    janelaHojeFim: "DATA_INVALIDA",
    painelHojeAbc: "DATA_INVALIDA",
  };
  for (const [nome, subcodigo] of Object.entries(esperados)) {
    const s = saida[nome];
    assert.ok(s, `caso ${nome} nao rodou`);
    assert.equal(s.erro, "ErroDominio", `${nome}: ${JSON.stringify(s)}`);
    assert.equal(s.subcodigo, subcodigo, nome);
    assert.ok(s.ms < 100, `${nome} demorou ${s.ms} ms`);
  }
  assert.deepEqual(Object.keys(saida).sort(), Object.keys(esperados).sort());
});

// ------------------------------------------------------------------ pureza do dominio

const PUROS = ["datas", "dias-uteis", "saldo", "estados", "cobertura", "indicadores", "janela"].map((n) => `src/lib/ausencias/${n}.ts`);
const PROIBIDOS = [/^@\/lib\/db(\/|$)/, /(^|\/)logger(\.ts)?$/, /^next(\/|$)/, /^node:(fs|child_process|http|https|net)$/, /^(fs|child_process|http|https|net)$/];

function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function importsDe(arquivo: string): string[] {
  const codigo = semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), "utf8"));
  const especificadores = [...codigo.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
  especificadores.push(...[...codigo.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]));
  especificadores.push(...[...codigo.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]));
  return especificadores;
}

function resolverLocal(origem: string, especificador: string): string | null {
  let base: string | null = null;
  if (especificador.startsWith("@/")) base = path.join("src", especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.join(path.dirname(origem), especificador);
  if (base === null) return null;
  for (const candidato of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(path.join(RAIZ, candidato)) && fs.statSync(path.join(RAIZ, candidato)).isFile()) return candidato;
  }
  return null;
}

test("pureza: o dominio nao importa @/lib/db, logger nem next/* (nem transitivamente)", () => {
  const visitados = new Set<string>();
  const fila = [...PUROS];
  while (fila.length > 0) {
    const arquivo = fila.pop() as string;
    if (visitados.has(arquivo)) continue;
    visitados.add(arquivo);
    for (const esp of importsDe(arquivo)) {
      for (const proibido of PROIBIDOS) {
        assert.equal(proibido.test(esp), false, `${arquivo} importa "${esp}" (proibido no dominio puro)`);
      }
      const local = resolverLocal(arquivo, esp);
      if (local !== null) fila.push(local);
    }
  }
  assert.ok(visitados.size >= PUROS.length);
  assert.ok(visitados.has("src/lib/errors.ts"), "a leitura transitiva deveria chegar em @/lib/errors");
  assert.ok(visitados.has("src/lib/ausencias/erros.ts"));
  // O verificador funciona: um import proibido seria pego.
  assert.ok(PROIBIDOS.some((p) => p.test("@/lib/db")));
  assert.ok(PROIBIDOS.some((p) => p.test("@/lib/logger")));
  assert.ok(PROIBIDOS.some((p) => p.test("next/server")));
  assert.ok(importsDe("tests/dominio.test.ts").length > 5);
});

test("pureza: sem relogio do sistema, aleatoriedade nem sintaxe que o strip-types nao roda", () => {
  for (const arquivo of PUROS) {
    const codigo = semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), "utf8"));
    assert.equal(/Date\.now\s*\(/.test(codigo), false, `${arquivo}: Date.now()`);
    assert.equal(/new\s+Date\s*\(\s*\)/.test(codigo), false, `${arquivo}: new Date() sem argumento`);
    assert.equal(/Math\.random\s*\(/.test(codigo), false, `${arquivo}: Math.random()`);
    assert.equal(/\bprocess\.env\b/.test(codigo), false, `${arquivo}: process.env`);
    assert.equal(/\benum\s+\w+/.test(codigo), false, `${arquivo}: enum`);
    assert.equal(/\bnamespace\s+\w+/.test(codigo), false, `${arquivo}: namespace`);
    assert.equal(/constructor\s*\([^)]*\b(private|public|protected|readonly)\s/.test(codigo), false, `${arquivo}: propriedade de parametro`);
  }
});
