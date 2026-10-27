/**
 * Integracao C2 -> C4 (BR24-005): os servicos REAIS (dominio + SQLite + porta
 * Bitrix) atendendo as rotas `/api/ausencias/*`, em banco TEMPORARIO e com o
 * Bitrix FAKE. Nenhuma escrita em portal real, nenhuma rede.
 *
 *   npm test   (ou: node --test tests/integracao.test.ts)
 *
 * Cobre:
 *  1. Regressoes do ciclo (cada teste nomeia o defeito que fixa).
 *  2. Fluxo completo pela API sobre SQLite.
 *  3. Persistencia: o que um PROCESSO grava, outro processo le (reinicio).
 *  4. Permissoes e vazamento de dado sensivel atravessando a persistencia.
 *
 * Dados 100% ficticios.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import type { CalendarioTrabalho, DataISO, Relogio, SessaoDemo } from "../src/lib/ausencias/tipos.ts";
import type { EventoCalendarioBitrix, PortaBitrix } from "../src/lib/ausencias/portas.ts";

const raiz = path.resolve(import.meta.dirname, "..");
const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), "br24-int-"));
const caminhoDb = path.join(dirTemp, "integracao.db");
const CHAVE = crypto.randomBytes(32).toString("base64");

process.env.DATABASE_PATH = caminhoDb;
process.env.APP_ENCRYPTION_KEY = CHAVE;
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.MODO_DEMO = "1";
delete process.env.BITRIX_ESCRITA;
delete process.env.DEMO_HOJE;

const HOJE: DataISO = "2026-10-26";
const executarArquivo = promisify(execFile);

const { getDb } = await import("../src/lib/db/index.ts");
const { removerPortal } = await import("../src/lib/db/portals.ts");
const { PORTAL_DEMO, semearDemo } = await import("../src/lib/ausencias/seed.ts");
const { semearPedidosDemo, calendarioDemo } = await import("../src/lib/ausencias/seed-demo-pedidos.ts");
const { criarServicosAusencias } = await import("../src/lib/ausencias/servicos-impl.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");

const M = PORTAL_DEMO;

/* ------------------------------------------------------------- utilitarios */

function relogio(hoje: DataISO = HOJE): Relogio {
  return { hoje: () => hoje, agora: () => `${hoje}T12:00:00.000Z` };
}

function sessao(pessoaId: string, papel: SessaoDemo["papel"] = "colaborador"): SessaoDemo {
  return { pessoaId, papel };
}

/** Porta Bitrix minima em memoria; os ganchos permitem injetar falha. */
class PortaDeTeste implements PortaBitrix {
  eventos = new Map<string, { marcador: string; ownerId: number }>();
  notificacoes: { bitrixUserId: number; mensagem: string }[] = [];
  aoBuscar: (() => void) | null = null;
  aoNotificar: (() => never) | null = null;
  private proximo = 1;

  async buscarEvento(marcador: string): Promise<{ id: string } | null> {
    this.aoBuscar?.();
    for (const [id, e] of this.eventos) if (e.marcador === marcador) return { id };
    return null;
  }

  async criarEvento(evento: EventoCalendarioBitrix): Promise<{ id: string; secao?: number }> {
    const id = `teste-${this.proximo++}`;
    this.eventos.set(id, { marcador: evento.marcador, ownerId: evento.ownerId });
    return { id };
  }

  async removerEvento(id: string): Promise<void> {
    this.eventos.delete(id);
  }

  async calendarioTrabalho(): Promise<CalendarioTrabalho> {
    return { diasNaoUteis: ["SA", "SU"], feriados: ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"], excecoesTrabalhadas: [] };
  }

  async notificar(bitrixUserId: number, mensagem: string): Promise<void> {
    if (this.aoNotificar) this.aoNotificar();
    this.notificacoes.push({ bitrixUserId, mensagem });
  }
}

function recriarBanco(): void {
  removerPortal(M);
  semearDemo({ hoje: HOJE });
  semearPedidosDemo({ hoje: HOJE, cal: calendarioDemo() });
}

async function servicosComPorta(porta: PortaBitrix) {
  const sv = criarServicosAusencias({ portalMemberId: M, relogio: relogio(), porta });
  await sv.aquecerCalendario();
  return sv;
}

/** Roda `codigo` num processo novo, com o MESMO arquivo de banco. */
async function emOutroProcesso(codigo: string, env: Record<string, string> = {}): Promise<unknown> {
  const { stdout, stderr } = await executarArquivo(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      pathToFileURL(path.join(raiz, "tests", "registrar-alias.mjs")).href,
      "--input-type=module",
      "-e",
      codigo,
    ],
    {
      cwd: raiz,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_PATH: caminhoDb,
        APP_ENCRYPTION_KEY: CHAVE,
        APP_BASE_URL: "http://localhost:3000",
        MODO_DEMO: "1",
        RAIZ_SRC: pathToFileURL(path.join(raiz, "src")).href,
        ...env,
      },
    },
  );
  const linha = stdout.split("\n").find((l) => l.startsWith("SAIDA:"));
  assert.ok(linha, `processo filho sem SAIDA. stderr=${stderr}`);
  return JSON.parse(linha.slice(6)) as unknown;
}

before(() => {
  recriarBanco();
});

after(() => {
  try {
    getDb().close();
  } catch {
    /* ja fechado */
  }
  fs.rmSync(dirTemp, { recursive: true, force: true });
});

/* =================================================== 1. regressoes do ciclo */

describe("regressoes", () => {
  beforeEach(() => {
    recriarBanco();
  });

  test("boot: fora do modo demonstracao e sem portal ativo, NAO cai no tenant de demonstracao", async () => {
    // Defeito: `portalDeAusencias()` devolvia `demo:ficticio` quando nao havia
    // portal configurado, misturando dado ficticio com instalacao real.
    const r = (await emOutroProcesso(
      `const { portalDeAusencias } = await import(process.env.RAIZ_SRC + "/lib/ausencias/boot.ts");
       try { console.log("SAIDA:" + JSON.stringify({ ok: true, portal: portalDeAusencias() })); }
       catch (e) { console.log("SAIDA:" + JSON.stringify({ ok: false, codigo: e.codigo ?? null })); }`,
      { MODO_DEMO: "0" },
    )) as { ok: boolean; portal?: string; codigo?: string };
    assert.equal(r.ok, false, "sem portal ativo o app tem de recusar, nao servir a demonstracao");
    assert.equal(r.portal, undefined);
    assert.equal(r.codigo, "SEM_CONFIGURACAO");
  });

  test("boot: DEMO_HOJE com data inexistente e recusado (nada de 31/02 circulando)", async () => {
    // Defeito: `hojeDemo()` so conferia o FORMATO; "2026-02-31" virava a data
    // de referencia de saldo, prazo e sincronizacao.
    const r = (await emOutroProcesso(
      `const { hojeDemo } = await import(process.env.RAIZ_SRC + "/lib/ausencias/seed-demo-pedidos.ts");
       try { console.log("SAIDA:" + JSON.stringify({ ok: true, hoje: hojeDemo() })); }
       catch (e) { console.log("SAIDA:" + JSON.stringify({ ok: false, msg: String(e.message).slice(0, 60) })); }`,
      { DEMO_HOJE: "2026-02-31" },
    )) as { ok: boolean; hoje?: string; msg?: string };
    assert.equal(r.ok, false, "data inexistente nao pode ser aceita");
    assert.match(r.msg ?? "", /DEMO_HOJE/);

    // Data real continua valendo.
    const bom = (await emOutroProcesso(
      `const { hojeDemo } = await import(process.env.RAIZ_SRC + "/lib/ausencias/seed-demo-pedidos.ts");
       console.log("SAIDA:" + JSON.stringify({ hoje: hojeDemo() }));`,
      { DEMO_HOJE: "2026-11-30" },
    )) as { hoje: string };
    assert.equal(bom.hoje, "2026-11-30");
  });

  test("seed: dois processos semeando ao mesmo tempo nao duplicam nem quebram", async () => {
    // Defeito: a verificacao "ja existe pedido de seed" ficava FORA da
    // transacao imediata; dois boots simultaneos semeavam os dois.
    removerPortal(M);
    semearDemo({ hoje: HOJE });
    const codigo = `const { semearPedidosDemo } = await import(process.env.RAIZ_SRC + "/lib/ausencias/seed-demo-pedidos.ts");
       try { const r = semearPedidosDemo(); console.log("SAIDA:" + JSON.stringify({ ok: true, pedidos: r.pedidos })); }
       catch (e) { console.log("SAIDA:" + JSON.stringify({ ok: false, msg: String(e.message).slice(0, 80) })); }`;
    const [a, b] = (await Promise.all([emOutroProcesso(codigo), emOutroProcesso(codigo)])) as {
      ok: boolean;
      pedidos?: number;
      msg?: string;
    }[];
    assert.equal(a.ok, true, `processo A falhou: ${a.msg}`);
    assert.equal(b.ok, true, `processo B falhou: ${b.msg}`);
    assert.deepEqual([a.pedidos, b.pedidos].sort(), [0, 13], "exatamente um dos processos semeia");
    const n = (getDb().prepare("SELECT COUNT(*) AS n FROM pedido WHERE portal_member_id = ?").get(M) as { n: number }).n;
    assert.equal(n, 13);
  });

  test("sincronizacao que falha DEPOIS do commit nao desfaz a decisao do gestor", async () => {
    // Defeito: `await sincronizar()` ficava fora de try/catch. A transacao ja
    // estava confirmada, mas a excecao virava 500 e o gestor achava que a
    // aprovacao nao aconteceu.
    const porta = new PortaDeTeste();
    const sv = await servicosComPorta(porta);
    const criado = await sv.solicitar(sessao("ana"), { tipoId: "outro", inicio: "2027-01-11", fim: "2027-01-12" });

    // Depois de falar com o Bitrix, a gravacao do resultado falha (lease
    // disputado por outro processo, SQLITE_BUSY, relogio indisponivel...).
    porta.aoBuscar = () => {
      throw Object.assign(new Error("falha de infraestrutura apos o COMMIT"), { apos: true });
    };
    const aprovado = await sv.decidir(sessao("carlos", "gestor"), criado.id, { decisao: "aprovar", versao: criado.versao });
    assert.equal(aprovado.status, "aprovada");

    const noBanco = repo.lerPedidoInterno(M, criado.id);
    assert.equal(noBanco?.status, "aprovada", "a decisao esta no banco");
    const job = repo.obterJobDoPedido(M, criado.id, "adicionar");
    assert.ok(job, "o job continua na fila para o botao Reprocessar");
    assert.notEqual(job.estado, "ok");
  });

  test("cancelamento tambem sobrevive a falha da sincronizacao", async () => {
    const porta = new PortaDeTeste();
    const sv = await servicosComPorta(porta);
    const criado = await sv.solicitar(sessao("ana"), { tipoId: "outro", inicio: "2027-02-08", fim: "2027-02-09" });
    await sv.decidir(sessao("carlos", "gestor"), criado.id, { decisao: "aprovar", versao: criado.versao });

    porta.aoBuscar = () => {
      throw new Error("falha de infraestrutura apos o COMMIT");
    };
    const atual = repo.lerPedidoInterno(M, criado.id);
    const cancelado = await sv.cancelar(sessao("carlos", "gestor"), criado.id);
    assert.equal(cancelado.status, "cancelada");
    assert.equal(repo.lerPedidoInterno(M, criado.id)?.status, "cancelada");
    assert.ok(atual);
  });

  test("notificacao ao Bitrix nunca derruba o processo com rejeicao nao tratada", async () => {
    // Defeito: `void avisarBitrix(...)` em `lembrarGestor` deixava uma promessa
    // solta; qualquer excecao fora do try interno matava o worker do Next.
    const vistos: unknown[] = [];
    const capturar = (motivo: unknown) => vistos.push(motivo);
    process.on("unhandledRejection", capturar);
    try {
      const porta = new PortaDeTeste();
      const sv = await servicosComPorta(porta);
      const pendente = repo
        .listarPedidosDaPessoa(M, "ana", ["pendente"])
        .find((p) => p.status === "pendente");
      assert.ok(pendente, "a semente tem um pedido pendente da Ana");

      // (a) rejeicao comum da porta.
      porta.aoNotificar = () => {
        throw new Error("portal indisponivel");
      };
      sv.lembrarGestor(sessao("marina", "admin"), pendente.id);

      // (b) erro cujo PROPRIO tratamento falha (getter hostil em `name`).
      class ErroVenenoso extends Error {
        get name(): string {
          throw new Error("getter hostil");
        }
      }
      porta.aoNotificar = () => {
        throw new ErroVenenoso("veneno");
      };
      repo.conexao().prepare("DELETE FROM notificacao WHERE portal_member_id = ? AND etapa LIKE 'lembrete:%'").run(M);
      sv.lembrarGestor(sessao("marina", "admin"), pendente.id);

      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(vistos, [], "nenhuma rejeicao pode escapar");
      // O lembrete interno (fonte da verdade) foi gravado mesmo assim.
      const n = repo.listarNotificacoes(M, "carlos").filter((x) => x.etapa.startsWith("lembrete:"));
      assert.equal(n.length, 1);
    } finally {
      process.off("unhandledRejection", capturar);
    }
  });
});

test("pedido persiste e permanece autorizado apos reinicio em outro processo", async () => {
  recriarBanco();
  const sv = await servicosComPorta(new PortaDeTeste());
  const criado = await sv.solicitar(sessao("ana"), { tipoId: "doenca", inicio: "2027-03-08", fim: "2027-03-09", motivoPrivado: "SENTINELA-PRIVADA-TESTE" });
  const aprovado = await sv.decidir(sessao("carlos", "gestor"), criado.id, { decisao: "aprovar", versao: criado.versao });
  assert.equal(aprovado.status, "aprovada");
  const resultado = await emOutroProcesso(`
    const { criarServicosAusencias } = await import(process.env.RAIZ_SRC + "/lib/ausencias/servicos-impl.ts");
    const { FakeBitrix } = await import(process.env.RAIZ_SRC + "/lib/bitrix/ausencias/fake.ts");
    const sv = criarServicosAusencias({portalMemberId:"demo:ficticio", relogio:{hoje:()=>"2026-10-26",agora:()=>"2026-10-26T12:00:00.000Z"},porta:new FakeBitrix()});
    const gestor = sv.pedido({pessoaId:"carlos",papel:"gestor"}, ${criado.id});
    let negado = false; try { sv.pedido({pessoaId:"bruno",papel:"admin"}, ${criado.id}); } catch { negado = true; }
    console.log("SAIDA:" + JSON.stringify({gestor,negado}));
  `) as { gestor: { status: string; tipo: string }; negado: boolean };
  assert.equal(resultado.gestor.status, "aprovada");
  assert.equal(resultado.gestor.tipo, "Ausência");
  assert.equal(resultado.negado, true);
  assert.ok(!JSON.stringify(resultado).includes("SENTINELA-PRIVADA-TESTE"));
  for (const t of ["pedido", "notificacao", "auditoria", "sync_job", "operation_log"]) {
    const linhas = getDb().prepare(`SELECT * FROM "${t}"`).all();
    assert.ok(!JSON.stringify(linhas).includes("SENTINELA-PRIVADA-TESTE"), t);
  }
});
