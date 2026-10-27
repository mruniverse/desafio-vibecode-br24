/**
 * Testes da persistencia de Ferias e Ausencias (BR24-005, C2 parte 1):
 * migracoes 002/003, repositorios e seed. Banco temporario via DATABASE_PATH.
 *
 *   npm run test:servicos
 *
 * Dados 100% ficticios. Concorrencia de verdade: processos filhos disputam o
 * mesmo arquivo SQLite (UNIQUE de pedido_dia e decisao atomica).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import type { NovoPedido } from "../src/lib/ausencias/repo/pedidos.ts";
import type { SessaoDemo } from "../src/lib/ausencias/tipos.ts";

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), "br24-srv-"));
const caminhoDb = path.join(dirTemp, "teste.db");
const chave = crypto.randomBytes(32).toString("base64");
process.env.DATABASE_PATH = caminhoDb;
process.env.APP_ENCRYPTION_KEY = chave;
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.MODO_DEMO = "1";

const raiz = path.resolve(import.meta.dirname, "..");
const { getDb } = await import("../src/lib/db/index.ts");
const { salvarPortal, removerPortal } = await import("../src/lib/db/portals.ts");
const { semearDemo, PORTAL_DEMO } = await import("../src/lib/ausencias/seed.ts");
const repo = await import("../src/lib/ausencias/repo/index.ts");
const { ErroDominio } = await import("../src/lib/ausencias/erros.ts");

const M = PORTAL_DEMO;
const SENTINELA = "SENTINELA_SECRETA";
const AGORA = "2026-10-26T12:00:00.000Z";

const TABELAS_AUSENCIAS = [
  "tipo",
  "equipe",
  "pessoa",
  "pedido",
  "lancamento",
  "etapa",
  "notificacao",
  "pedido_dia",
  "auditoria",
  "sync_job",
];

// --- utilitarios -----------------------------------------------------------

function sessao(pessoaId: string, papel: SessaoDemo["papel"] = "colaborador"): SessaoDemo {
  return { pessoaId, papel };
}

/** Dias uteis (seg-sex) simples, so para montar entradas de teste. */
function diasUteisSimples(inicio: string, fim: string): string[] {
  const saida: string[] = [];
  const d = new Date(`${inicio}T00:00:00Z`);
  const f = new Date(`${fim}T00:00:00Z`);
  while (d <= f) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) saida.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return saida;
}

/** Semana n (seg-sex) a partir de 2027-01-04; cada teste usa a sua. */
function semana(n: number): { inicio: string; fim: string } {
  const base = new Date("2027-01-04T00:00:00Z");
  const ini = new Date(base.getTime() + n * 7 * 86_400_000);
  const fim = new Date(ini.getTime() + 4 * 86_400_000);
  return { inicio: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}

function novo(
  pessoaId: string,
  tipoId: string,
  inicio: string,
  fim: string,
  extra: Partial<NovoPedido> = {},
): NovoPedido {
  const dias = diasUteisSimples(inicio, fim);
  return {
    pessoaId,
    tipoId,
    inicio,
    fim,
    diasUteis: dias.length,
    diasDebitoPorAno: { [inicio.slice(0, 4)]: dias.length },
    diasOcupados: dias,
    excedeSaldo: false,
    criadoEm: AGORA,
    ...extra,
  };
}

function contar(tabela: string, portal: string = M): number {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM "${tabela}" WHERE portal_member_id = ?`)
      .get(portal) as { n: number }
  ).n;
}

function contagens(): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const t of ["portal", ...TABELAS_AUSENCIAS]) {
    saida[t] = (getDb().prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
  }
  return saida;
}

function erroDe(fn: () => unknown): InstanceType<typeof ErroDominio> {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ErroDominio, `esperava ErroDominio, veio: ${String(e)}`);
    return e;
  }
  assert.fail("esperava que lancasse ErroDominio");
}

const SCRIPT_FILHO = `
const base = process.env.RAIZ_SRC;
const repo = await import(base + "/lib/ausencias/repo/index.ts");
const args = JSON.parse(process.env.ARGS);
while (Date.now() < Number(process.env.START_AT)) { /* barreira de largada */ }
try {
  const r = process.env.FN === "criar"
    ? repo.criarPedido(process.env.PORTAL, args)
    : repo.decidirPedido(process.env.PORTAL, args);
  console.log("RESULTADO:" + JSON.stringify({ ok: true, id: r.id, status: r.status }));
} catch (e) {
  console.log("RESULTADO:" + JSON.stringify({ ok: false, subcodigo: e.subcodigo ?? null, codigo: e.codigo ?? null, msg: String(e.message) }));
}
`;

interface ResultadoFilho {
  ok: boolean;
  id?: number;
  status?: string;
  subcodigo?: string | null;
  codigo?: string | null;
  msg?: string;
}

function rodarFilho(fn: "criar" | "decidir", args: unknown, startAt: number): Promise<ResultadoFilho> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--import",
        pathToFileURL(path.join(raiz, "tests", "registrar-alias.mjs")).href,
        "--input-type=module",
        "-e",
        SCRIPT_FILHO,
      ],
      {
        cwd: raiz,
        env: {
          ...process.env,
          RAIZ_SRC: pathToFileURL(path.join(raiz, "src")).href,
          PORTAL: M,
          FN: fn,
          ARGS: JSON.stringify(args),
          START_AT: String(startAt),
        },
        timeout: 60_000,
      },
      (erro, stdout, stderr) => {
        const linha = stdout.split("\n").find((l) => l.startsWith("RESULTADO:"));
        if (!linha) {
          reject(new Error(`filho sem resultado (${erro?.message ?? ""}): ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(JSON.parse(linha.slice("RESULTADO:".length)) as ResultadoFilho);
      },
    );
  });
}

// --- seed ------------------------------------------------------------------

test("seed: 2 execucoes => mesmos COUNT(*) e conteudo esperado", () => {
  salvarPortal({
    memberId: "portal-real-exemplo",
    domain: "cliente-ficticio.bitrix24.com.br",
    clientEndpoint: "https://cliente-ficticio.bitrix24.com.br/rest",
    authMode: "OAUTH",
  });
  const portalRealAntes = getDb()
    .prepare("SELECT * FROM portal WHERE member_id = ?")
    .get("portal-real-exemplo");

  const r1 = semearDemo();
  assert.equal(r1.executado, true);
  const depois1 = contagens();
  const r2 = semearDemo();
  const depois2 = contagens();

  assert.deepEqual(depois2, depois1, "seed nao e idempotente");
  assert.deepEqual(r2.inseridos, { tipos: 0, equipes: 0, pessoas: 0, lancamentos: 0, etapas: 0 });

  assert.equal(contar("tipo"), 8);
  assert.equal(contar("equipe"), 3);
  assert.equal(contar("pessoa"), 10);
  assert.equal(contar("etapa"), 4);
  assert.equal(contar("lancamento"), 20);
  const admins = getDb()
    .prepare("SELECT COUNT(*) AS n FROM pessoa WHERE portal_member_id = ? AND papel = 'admin'")
    .get(M) as { n: number };
  assert.equal(admins.n, 2);

  // 22 uteis de ferias e 5 de folga por pessoa.
  const somas = getDb()
    .prepare(
      `SELECT carteira, MIN(s) AS min, MAX(s) AS max FROM
         (SELECT pessoa_id, carteira, SUM(dias) AS s FROM lancamento WHERE portal_member_id = ?
           GROUP BY pessoa_id, carteira) GROUP BY carteira`,
    )
    .all(M) as { carteira: string; min: number; max: number }[];
  assert.deepEqual(
    somas.map((s) => [s.carteira, s.min, s.max]),
    [["ferias", 22, 22], ["folga", 5, 5]],
  );

  // Nada no seed carrega dado de producao; tudo marcado origem='seed'.
  const naoSeed = getDb()
    .prepare("SELECT COUNT(*) AS n FROM pessoa WHERE portal_member_id = ? AND origem <> 'seed'")
    .get(M) as { n: number };
  assert.equal(naoSeed.n, 0);

  // Portal demo e ficticio; portal real intocado.
  const demo = getDb().prepare("SELECT * FROM portal WHERE member_id = ?").get(M) as Record<string, unknown>;
  assert.equal(demo.auth_mode, "WEBHOOK");
  assert.equal(demo.webhook_url_enc, null);
  assert.equal(demo.setup_completed, 0);
  assert.deepEqual(
    getDb().prepare("SELECT * FROM portal WHERE member_id = ?").get("portal-real-exemplo"),
    portalRealAntes,
  );
  assert.equal(contar("pessoa", "portal-real-exemplo"), 0);

  // Etapas respeitam a whitelist de variaveis.
  for (const e of repo.listarEtapas(M)) {
    for (const v of e.mensagem.matchAll(/\{([^}]*)\}/g)) {
      assert.ok(["nome", "periodo", "tipoPublico", "prazo"].includes(v[1]), `variavel proibida {${v[1]}}`);
    }
  }
  assert.deepEqual(
    repo.listarEtapas(M).map((e) => e.chave),
    ["enviado", "com_gestor", "confirmado", "recusado"],
  );
});

test("seed: sem MODO_DEMO=1 nao cria nada (processo isolado)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-srv-off-"));
  try {
    const codigo = `
      const { semearDemo } = await import(process.env.RAIZ_SRC + "/lib/ausencias/seed.ts");
      const { getDb } = await import(process.env.RAIZ_SRC + "/lib/db/index.ts");
      const r = semearDemo();
      const n = getDb().prepare("SELECT COUNT(*) AS n FROM portal").get().n;
      console.log("SAIDA:" + JSON.stringify({ executado: r.executado, portais: n }));
    `;
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types", "--no-warnings",
        "--import", pathToFileURL(path.join(raiz, "tests", "registrar-alias.mjs")).href,
        "--input-type=module", "-e", codigo,
      ],
      {
        cwd: raiz,
        encoding: "utf8",
        env: {
          ...process.env,
          MODO_DEMO: "0",
          DATABASE_PATH: path.join(dir, "off.db"),
          RAIZ_SRC: pathToFileURL(path.join(raiz, "src")).href,
        },
      },
    );
    const linha = r.stdout.split("\n").find((l) => l.startsWith("SAIDA:"));
    assert.ok(linha, `sem saida: ${r.stderr}`);
    assert.deepEqual(JSON.parse(linha.slice(6)), { executado: false, portais: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("seed: recusa portal demo que ganhou credencial (nao toca portal real)", () => {
  const db = getDb();
  db.prepare("UPDATE portal SET webhook_url_enc = 'x' WHERE member_id = ?").run(M);
  try {
    assert.throws(() => semearDemo(), /Seed recusada/);
  } finally {
    db.prepare("UPDATE portal SET webhook_url_enc = NULL WHERE member_id = ?").run(M);
  }
});

// --- esquema ---------------------------------------------------------------

test("toda tabela de ausencias tem portal_member_id NOT NULL, FK em cascata e indices por ele", () => {
  const db = getDb();
  const existentes = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((t) => t.name);
  for (const t of TABELAS_AUSENCIAS) assert.ok(existentes.includes(t), `tabela ${t} ausente`);

  for (const t of TABELAS_AUSENCIAS) {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; notnull: number }[];
    const col = cols.find((c) => c.name === "portal_member_id");
    assert.ok(col && col.notnull === 1, `${t}.portal_member_id deve ser NOT NULL`);

    const fks = db.prepare(`PRAGMA foreign_key_list("${t}")`).all() as {
      table: string; from: string; to: string; on_delete: string;
    }[];
    assert.ok(
      fks.some((f) => f.table === "portal" && f.from === "portal_member_id" && f.to === "member_id" && f.on_delete === "CASCADE"),
      `${t} sem FK portal ON DELETE CASCADE`,
    );

    const indices = db.prepare(`PRAGMA index_list("${t}")`).all() as { name: string }[];
    for (const ix of indices) {
      const colunas = (db.prepare(`PRAGMA index_info("${ix.name}")`).all() as { name: string }[]).map((c) => c.name);
      // Unica excecao: UNIQUE(pedido_id, operacao) exigido pelo contrato do sync_job.
      if (t === "sync_job" && colunas.join(",") === "pedido_id,operacao") continue;
      assert.equal(colunas[0], "portal_member_id", `indice ${ix.name} de ${t} nao comeca por portal_member_id`);
    }
  }
  assert.ok(
    existentes.every((n) => n !== "acesso_equipe"),
    "AcessoEquipe esta no backlog: nao deve existir",
  );
});

test("pedido: o CHECK rejeita par (status, sincronizacao) invalido", () => {
  const p = repo.criarPedido(M, novo("elisa", "ferias", semana(40).inicio, semana(40).fim));
  assert.throws(
    () => getDb().prepare("UPDATE pedido SET sincronizacao = 'ok' WHERE id = ?").run(p.id),
    /CHECK/,
  );
  repo.cancelarPedido(M, { pedidoId: p.id, canceladoPor: "elisa", canceladoEm: "2026-10-26", instante: AGORA });
});

// --- criptografia do motivo ------------------------------------------------

test("motivo_privado nao aparece em texto puro no banco (tabelas e arquivo)", () => {
  const s = semana(1);
  const sens = repo.criarPedido(M, novo("ana", "doenca", s.inicio, s.fim, { motivoPrivado: SENTINELA }));
  const comum = semana(2);
  repo.criarPedido(M, novo("bruno", "ferias", comum.inicio, comum.fim, { justificativa: "MARCADOR_EM_CLARO_123" }));

  // Round-trip: dono e admin veem; gestor e colega nao.
  assert.equal(repo.lerPedidoInterno(M, sens.id, { comMotivoPrivado: true })?.motivoPrivado, SENTINELA);
  assert.equal(repo.lerPedidoVisivel(M, sessao("ana"), sens.id)?.motivoPrivado, SENTINELA);
  assert.equal(repo.lerPedidoVisivel(M, sessao("marina", "admin"), sens.id)?.motivoPrivado, SENTINELA);
  const paraGestor = repo.lerPedidoVisivel(M, sessao("carlos", "gestor"), sens.id);
  assert.ok(paraGestor, "gestor da equipe enxerga o pedido (sem o motivo)");
  assert.equal(paraGestor.motivoPrivado, undefined);
  assert.equal(JSON.stringify(repo.listarPedidosVisiveis(M, sessao("carlos", "gestor"))).includes(SENTINELA), false);
  assert.equal(JSON.stringify(repo.listarPedidosVisiveis(M, sessao("bruno"))).includes(SENTINELA), false);
  assert.equal(repo.lerPedidoInterno(M, sens.id)?.motivoPrivado, undefined, "leitura interna nao decifra por padrao");

  // Varre TODAS as colunas de texto de todas as tabelas.
  const db = getDb();
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const achados: string[] = [];
  for (const { name } of tabelas) {
    for (const linha of db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]) {
      for (const [col, v] of Object.entries(linha)) {
        if (typeof v === "string" && v.includes(SENTINELA)) achados.push(`${name}.${col}`);
      }
    }
  }
  assert.deepEqual(achados, [], `sentinela em texto puro em: ${achados.join(", ")}`);
  const cifrado = db.prepare("SELECT motivo_privado_enc AS c FROM pedido WHERE id = ?").get(sens.id) as { c: string };
  assert.match(cifrado.c, /^v1\./);

  // Varre os bytes do arquivo do banco (e do WAL), com controle positivo.
  db.pragma("wal_checkpoint(TRUNCATE)");
  const arquivos = [caminhoDb, `${caminhoDb}-wal`].filter((f) => fs.existsSync(f));
  const bytes = Buffer.concat(arquivos.map((f) => fs.readFileSync(f)));
  assert.ok(bytes.includes(Buffer.from("MARCADOR_EM_CLARO_123")), "controle positivo: a varredura de bytes funciona");
  assert.equal(bytes.includes(Buffer.from(SENTINELA)), false, "SENTINELA_SECRETA em texto puro no arquivo do banco");
});

test("tipo sensivel rejeita justificativa; tipo comum rejeita motivoPrivado", () => {
  const s = semana(3);
  assert.equal(
    erroDe(() => repo.criarPedido(M, novo("ana", "doenca", s.inicio, s.fim, { justificativa: "texto livre de saude" }))).subcodigo,
    "TIPO_SENSIVEL",
  );
  assert.equal(
    erroDe(() => repo.criarPedido(M, novo("ana", "ferias", s.inicio, s.fim, { motivoPrivado: "x" }))).subcodigo,
    "TIPO_SENSIVEL",
  );
  assert.equal(repo.listarPedidosDaPessoa(M, "ana").filter((p) => p.inicio === s.inicio).length, 0, "nada gravado");
});

// --- escopo ----------------------------------------------------------------

test("listagem: colega nao ve pedido alheio; gestor so a equipe; admin tudo", () => {
  const sa = semana(4);
  const sp = semana(5);
  const pAna = repo.criarPedido(M, novo("ana", "ferias", sa.inicio, sa.fim));
  const pPaulo = repo.criarPedido(M, novo("paulo", "ferias", sp.inicio, sp.fim));

  const ids = (lista: { id: number }[]) => lista.map((p) => p.id);

  // Colega (Bruno) nao ve o pedido da Ana, nem por lista nem por id.
  assert.equal(ids(repo.listarPedidosVisiveis(M, sessao("bruno"))).includes(pAna.id), false);
  assert.equal(repo.lerPedidoVisivel(M, sessao("bruno"), pAna.id), null);
  assert.equal(repo.listarPedidosVisiveis(M, sessao("bruno", "admin")).some((p) => p.pessoaId === "ana"), false,
    "papel forjado na sessao e ignorado (papel vem do banco)");
  assert.deepEqual(repo.listarPedidosParaAprovar(M, sessao("bruno", "gestor")), []);
  assert.equal(repo.listarPedidosVisiveis(M, sessao("bruno"), { pessoaId: "ana" }).length, 0);

  // Dono ve o proprio.
  assert.ok(ids(repo.listarPedidosVisiveis(M, sessao("ana"))).includes(pAna.id));

  // Gestor da tec ve a equipe, nao ve a People.
  const carlos = repo.listarPedidosVisiveis(M, sessao("carlos", "gestor"));
  assert.ok(ids(carlos).includes(pAna.id));
  assert.equal(ids(carlos).includes(pPaulo.id), false);
  assert.equal(repo.lerPedidoVisivel(M, sessao("carlos", "gestor"), pPaulo.id), null);
  assert.ok(ids(repo.listarPedidosParaAprovar(M, sessao("carlos", "gestor"))).includes(pAna.id));

  // Gestor de outra equipe (Renata, Direcao) nao ve a tec.
  assert.equal(ids(repo.listarPedidosVisiveis(M, sessao("renata", "gestor"))).includes(pAna.id), false);

  // Admin ve tudo; mas a fila dele nunca contem o proprio pedido.
  const marina = repo.listarPedidosVisiveis(M, sessao("marina", "admin"));
  assert.ok(ids(marina).includes(pAna.id) && ids(marina).includes(pPaulo.id));
  assert.ok(ids(repo.listarPedidosParaAprovar(M, sessao("paulo", "admin"))).includes(pAna.id));
  assert.equal(ids(repo.listarPedidosParaAprovar(M, sessao("paulo", "admin"))).includes(pPaulo.id), false);

  // Pessoa inexistente (cookie forjado) nao ve nada.
  assert.deepEqual(repo.listarPedidosVisiveis(M, sessao("fantasma", "admin")), []);
  // Portal errado nao ve nada.
  assert.deepEqual(repo.listarPedidosVisiveis("outro-portal", sessao("marina", "admin")), []);

  // Lancamentos seguem o mesmo escopo.
  assert.equal(repo.listarLancamentosVisiveis(M, sessao("bruno"), "ana").length, 0);
  assert.equal(repo.listarLancamentosVisiveis(M, sessao("ana"), "ana").length, 2);
  assert.equal(repo.listarLancamentosVisiveis(M, sessao("carlos", "gestor"), "ana").length, 2);
  assert.equal(repo.listarLancamentosVisiveis(M, sessao("carlos", "gestor"), "paulo").length, 0);
  assert.equal(repo.listarLancamentosVisiveis(M, sessao("marina", "admin"), "paulo").length, 2);

  repo.cancelarPedido(M, { pedidoId: pAna.id, canceladoPor: "ana", canceladoEm: "2026-10-26", instante: AGORA });
  repo.cancelarPedido(M, { pedidoId: pPaulo.id, canceladoPor: "paulo", canceladoEm: "2026-10-26", instante: AGORA });
});

// --- concorrencia ----------------------------------------------------------

test("decisao dupla (mesmo processo): 1 vencedor e o perdedor nao altera nada", () => {
  const s = semana(6);
  const p = repo.criarPedido(M, novo("camila", "ferias", s.inicio, s.fim));
  const base = { pedidoId: p.id, versao: p.versao, decididoEm: AGORA };

  const aprovado = repo.decidirPedido(M, { ...base, decisao: "aprovar", decididoPor: "carlos" });
  assert.equal(aprovado.status, "aprovada");
  assert.equal(aprovado.sincronizacao, "pendente");
  assert.equal(aprovado.versao, p.versao + 1);

  const e = erroDe(() =>
    repo.decidirPedido(M, { ...base, decisao: "recusar", decididoPor: "marina", motivoDecisao: "motivo de recusa tardia" }),
  );
  assert.equal(e.subcodigo, "TRANSICAO_INVALIDA");
  const final = repo.lerPedidoInterno(M, p.id);
  assert.equal(final?.status, "aprovada");
  assert.equal(final?.motivoDecisao, undefined);
  assert.equal(final?.decididoPor, "carlos");
  assert.equal(
    (getDb().prepare("SELECT COUNT(*) AS n FROM sync_job WHERE pedido_id = ? AND operacao = 'adicionar'").get(p.id) as { n: number }).n,
    1,
  );
});

test("decisao: nao decide o proprio pedido, versao desatualizada e recusa sem motivo", () => {
  const s = semana(7);
  const p = repo.criarPedido(M, novo("carlos", "ferias", s.inicio, s.fim));
  assert.equal(
    erroDe(() => repo.decidirPedido(M, { pedidoId: p.id, versao: 0, decisao: "aprovar", decididoPor: "carlos", decididoEm: AGORA })).subcodigo,
    "SEM_PERMISSAO",
  );
  assert.equal(
    erroDe(() => repo.decidirPedido(M, { pedidoId: p.id, versao: 7, decisao: "aprovar", decididoPor: "renata", decididoEm: AGORA })).subcodigo,
    "TRANSICAO_INVALIDA",
  );
  assert.equal(
    erroDe(() => repo.decidirPedido(M, { pedidoId: p.id, versao: 0, decisao: "recusar", decididoPor: "renata", decididoEm: AGORA })).subcodigo,
    "JUSTIFICATIVA_OBRIGATORIA",
  );
  assert.equal(
    erroDe(() => repo.decidirPedido(M, { pedidoId: 999999, versao: 0, decisao: "aprovar", decididoPor: "renata", decididoEm: AGORA })).subcodigo,
    "NAO_ENCONTRADO",
  );
  assert.equal(repo.lerPedidoInterno(M, p.id)?.status, "pendente");

  // Recusa libera os dias e guarda a sugestao.
  const rec = repo.decidirPedido(M, {
    pedidoId: p.id, versao: 0, decisao: "recusar", decididoPor: "renata", decididoEm: AGORA,
    motivoDecisao: "equipe abaixo do minimo", sugestao: { inicio: "2027-03-01", fim: "2027-03-05" },
  });
  assert.equal(rec.status, "recusada");
  assert.equal(rec.sincronizacao, "nao_aplicavel");
  assert.deepEqual(rec.sugestao, { inicio: "2027-03-01", fim: "2027-03-05" });
  assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM pedido_dia WHERE pedido_id = ?").get(p.id) as { n: number }).n, 0);
  // Dias liberados: a mesma pessoa pode pedir de novo.
  const novamente = repo.criarPedido(M, novo("carlos", "ferias", s.inicio, s.fim));
  assert.equal(novamente.status, "pendente");
  repo.cancelarPedido(M, { pedidoId: novamente.id, canceladoPor: "carlos", canceladoEm: "2026-10-26", instante: AGORA });
});

test("decisao concorrente entre PROCESSOS: exatamente 1 vencedor", { timeout: 120_000 }, async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const s = semana(10 + rodada);
    const p = repo.criarPedido(M, novo("diego", "ferias", s.inicio, s.fim));
    const largada = Date.now() + 2500;
    const [a, b] = await Promise.all([
      rodarFilho("decidir", { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: AGORA }, largada),
      rodarFilho("decidir", { pedidoId: p.id, versao: p.versao, decisao: "recusar", decididoPor: "marina", decididoEm: AGORA, motivoDecisao: "recusa concorrente de teste" }, largada),
    ]);
    const vencedores = [a, b].filter((r) => r.ok);
    const perdedores = [a, b].filter((r) => !r.ok);
    assert.equal(vencedores.length, 1, `rodada ${rodada}: ${JSON.stringify([a, b])}`);
    assert.equal(perdedores[0].subcodigo, "TRANSICAO_INVALIDA");

    const final = repo.lerPedidoInterno(M, p.id);
    assert.equal(final?.status, vencedores[0].status);
    assert.equal(final?.versao, p.versao + 1, "so uma decisao incrementou a versao");
    const jobs = (getDb().prepare("SELECT COUNT(*) AS n FROM sync_job WHERE pedido_id = ?").get(p.id) as { n: number }).n;
    assert.equal(jobs, final?.status === "aprovada" ? 1 : 0);
    const dias = (getDb().prepare("SELECT COUNT(*) AS n FROM pedido_dia WHERE pedido_id = ?").get(p.id) as { n: number }).n;
    assert.equal(dias, final?.status === "aprovada" ? 5 : 0);
  }
});

test("dois PROCESSOS disputando o UNIQUE de pedido_dia: 1 vencedor, sem sobras", { timeout: 120_000 }, async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const s = semana(20 + rodada);
    const largada = Date.now() + 2500;
    // Periodos diferentes que dividem apenas a quarta e a quinta.
    const dias = diasUteisSimples(s.inicio, s.fim);
    const a = novo("felipe", "ferias", dias[0], dias[3]);
    const b = novo("felipe", "folga", dias[2], dias[4]);
    const [ra, rb] = await Promise.all([rodarFilho("criar", a, largada), rodarFilho("criar", b, largada)]);

    const vencedores = [ra, rb].filter((r) => r.ok);
    assert.equal(vencedores.length, 1, `rodada ${rodada}: ${JSON.stringify([ra, rb])}`);
    assert.equal([ra, rb].find((r) => !r.ok)?.subcodigo, "SOBREPOSICAO");

    const pedidos = (getDb()
      .prepare("SELECT COUNT(*) AS n FROM pedido WHERE pessoa_id = 'felipe' AND inicio >= ? AND inicio <= ?")
      .get(s.inicio, s.fim) as { n: number }).n;
    assert.equal(pedidos, 1, "o perdedor nao deixou pedido orfao");
    const diasOcupados = (getDb()
      .prepare("SELECT COUNT(*) AS n FROM pedido_dia WHERE pessoa_id = 'felipe' AND dia BETWEEN ? AND ?")
      .get(s.inicio, s.fim) as { n: number }).n;
    assert.equal(diasOcupados, vencedores[0] === ra ? 4 : 3);
  }
});

test("sobreposicao no mesmo processo: erro, estado intacto e pessoas diferentes nao conflitam", () => {
  const s = semana(30);
  const p = repo.criarPedido(M, novo("elisa", "ferias", s.inicio, s.fim));
  const antes = contar("pedido");
  assert.equal(erroDe(() => repo.criarPedido(M, novo("elisa", "outro", s.fim, s.fim))).subcodigo, "SOBREPOSICAO");
  assert.equal(contar("pedido"), antes);
  // Outra pessoa no mesmo periodo e permitido (conflito de equipe nao bloqueia).
  const q = repo.criarPedido(M, novo("bruno", "ferias", s.inicio, s.fim));
  assert.equal(q.status, "pendente");
  for (const x of [p, q]) {
    repo.cancelarPedido(M, { pedidoId: x.id, canceladoPor: x.pessoaId, canceladoEm: "2026-10-26", instante: AGORA });
  }
});

// --- cancelamento e sincronizacao -----------------------------------------

test("cancelar aprovada: libera dias futuros, enfileira remover; cancelar de novo falha", () => {
  const s = semana(31);
  const p = repo.criarPedido(M, novo("ana", "ferias", s.inicio, s.fim));
  repo.decidirPedido(M, { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: AGORA });

  // Cancela no meio do periodo: dias anteriores continuam contando.
  const dias = diasUteisSimples(s.inicio, s.fim);
  const c = repo.cancelarPedido(M, {
    pedidoId: p.id, canceladoPor: "carlos", canceladoEm: dias[2], instante: AGORA,
    diasDebitoPorAno: { "2027": 2 },
  });
  assert.equal(c.status, "cancelada");
  assert.equal(c.sincronizacao, "remocao_pendente");
  assert.equal(c.canceladoEm, dias[2]);
  assert.deepEqual(c.diasDebitoPorAno, { "2027": 2 });
  const restantes = (getDb().prepare("SELECT dia FROM pedido_dia WHERE pedido_id = ? ORDER BY dia").all(p.id) as { dia: string }[]).map((d) => d.dia);
  assert.deepEqual(restantes, dias.slice(0, 2));
  assert.ok(repo.obterJobDoPedido(M, p.id, "remover"));

  assert.equal(erroDe(() => repo.cancelarPedido(M, { pedidoId: p.id, canceladoPor: "carlos", canceladoEm: dias[3], instante: AGORA })).subcodigo, "TRANSICAO_INVALIDA");
  assert.equal(repo.lerPedidoInterno(M, p.id)?.canceladoEm, dias[2], "segundo cancelamento nao alterou nada");

  // A ausencia parcial ainda aparece para a cobertura ate canceladoEm-1.
  const ausencias = repo.listarAusenciasDaEquipe(M, "tec", s.inicio, s.fim).filter((a) => a.pedidoId === p.id);
  assert.equal(ausencias.length, 1);
  assert.equal(ausencias[0].canceladoEm, dias[2]);

  // Debitos para o saldo: pedidos que consomem carteira, sem motivo privado.
  const deb = repo.listarDebitosDaPessoa(M, "ana").find((d) => d.pedido.id === p.id);
  assert.equal(deb?.carteira, "ferias");
});

test("sync_job: adicionar -> remover serial, 3 falhas => falha_manual, reprocessar reabre", () => {
  // Escoa os jobs deixados por testes anteriores (a fila e por portal).
  for (let j = repo.tomarProximoJob(M, AGORA, AGORA); j; j = repo.tomarProximoJob(M, AGORA, AGORA)) {
    repo.concluirJob(M, j.id, AGORA);
  }
  const s = semana(32);
  const p = repo.criarPedido(M, novo("bruno", "ferias", s.inicio, s.fim));
  repo.decidirPedido(M, { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: AGORA });
  const lease = "2026-10-26T12:01:00.000Z";
  const depois = "2026-10-26T12:05:00.000Z";

  // Idempotente: enfileirar de novo nao duplica.
  assert.equal(repo.enfileirarJob(M, p.id, "adicionar", AGORA), false);

  const j1 = repo.tomarProximoJob(M, AGORA, lease);
  assert.ok(j1);
  assert.equal(j1.operacao, "adicionar");
  assert.equal(j1.tentativas, 1);
  assert.equal(repo.lerPedidoInterno(M, p.id)?.sincronizacao, "em_andamento");
  // Com lease valido ninguem mais pega o job (nem o do mesmo pedido).
  assert.equal(repo.tomarProximoJob(M, AGORA, lease), null);

  assert.equal(repo.falharJob(M, j1.id, "timeout\nem varias linhas", AGORA), "falha");
  assert.equal(repo.lerPedidoInterno(M, p.id)?.sincronizacao, "falha");
  assert.equal(repo.obterJob(M, j1.id)?.ultimoErro, "timeout em varias linhas");

  const j2 = repo.tomarProximoJob(M, AGORA, lease);
  assert.equal(j2?.id, j1.id);
  assert.equal(j2?.tentativas, 2);
  repo.falharJob(M, j1.id, "erro 2", AGORA);
  const j3 = repo.tomarProximoJob(M, AGORA, lease);
  assert.equal(j3?.tentativas, 3);
  assert.equal(repo.falharJob(M, j1.id, "erro 3", AGORA), "falha_manual");
  assert.equal(repo.lerPedidoInterno(M, p.id)?.sincronizacao, "falha_manual");
  assert.equal(repo.tomarProximoJob(M, depois, lease), null, "falha_manual nao e retomado sozinho");
  assert.equal(repo.listarLogSincronizacao(M).find((l) => l.pedidoId === p.id)?.estado, "falha_manual");

  assert.equal(repo.reprocessarJobs(M, depois, p.id), 1);
  assert.equal(repo.lerPedidoInterno(M, p.id)?.sincronizacao, "pendente");
  const j4 = repo.tomarProximoJob(M, depois, lease);
  assert.equal(j4?.tentativas, 1);
  repo.concluirJob(M, j4!.id, depois, { bitrixEventId: "evt-ficticio-1", ownerId: 7, secao: 3 });
  const ok = repo.lerPedidoInterno(M, p.id);
  assert.equal(ok?.sincronizacao, "ok");
  assert.equal(ok?.bitrixEventId, "evt-ficticio-1");

  // Cancelar enfileira remover; so roda apos o adicionar concluido; NOT_FOUND = removido.
  repo.cancelarPedido(M, { pedidoId: p.id, canceladoPor: "carlos", canceladoEm: "2026-10-26", instante: depois });
  const r = repo.tomarProximoJob(M, depois, lease);
  assert.equal(r?.operacao, "remover");
  repo.concluirJob(M, r!.id, depois);
  assert.equal(repo.lerPedidoInterno(M, p.id)?.sincronizacao, "removido");
  assert.equal(erroDe(() => repo.concluirJob(M, r!.id, depois)).subcodigo, "TRANSICAO_INVALIDA");
});

// --- notificacoes, lancamentos, auditoria ----------------------------------

test("notificacao unica por (pessoa, pedido, etapa) e caixa so da propria pessoa", () => {
  const s = semana(33);
  const p = repo.criarPedido(M, novo("camila", "ferias", s.inicio, s.fim));
  const dados = { pessoaId: "camila", pedidoId: p.id, etapa: "enviado", texto: "Olá, Camila!", criadaEm: AGORA };
  assert.equal(repo.gravarNotificacao(M, dados), true);
  assert.equal(repo.gravarNotificacao(M, dados), false);
  assert.equal(repo.gravarNotificacao(M, { ...dados, etapa: "lembrete:2026-10-27" }), true);
  assert.equal(repo.listarNotificacoes(M, "camila").filter((n) => n.pedidoId === p.id).length, 2);
  assert.equal(repo.listarNotificacoes(M, "bruno").filter((n) => n.pedidoId === p.id).length, 0);
  const id = repo.listarNotificacoes(M, "camila")[0].id;
  assert.equal(repo.marcarNotificacaoLida(M, "bruno", id), false);
  assert.equal(repo.marcarNotificacaoLida(M, "camila", id), true);
  repo.cancelarPedido(M, { pedidoId: p.id, canceladoPor: "camila", canceladoEm: "2026-10-26", instante: AGORA });
});

test("lancamento: ninguem credita a si; ajuste negativo ok; credito nao pode ser negativo", () => {
  assert.equal(
    erroDe(() => repo.criarLancamento(M, { pessoaId: "ana", ano: 2027, carteira: "ferias", tipo: "credito", dias: 2, motivo: "bonus fictício de teste", criadoPor: "ana", criadoEm: AGORA })).subcodigo,
    "SEM_PERMISSAO",
  );
  const l = repo.criarLancamento(M, { pessoaId: "ana", ano: 2027, carteira: "ferias", tipo: "ajuste", dias: -1, motivo: "ajuste fictício de teste", criadoPor: "marina", criadoEm: AGORA });
  assert.equal(l.dias, -1);
  assert.equal(
    erroDe(() => repo.criarLancamento(M, { pessoaId: "ana", ano: 2027, carteira: "ferias", tipo: "credito", dias: -3, motivo: "invalido de teste", criadoPor: "marina", criadoEm: AGORA })).subcodigo,
    "NUMERO_INVALIDO",
  );
  assert.equal(
    erroDe(() => repo.criarLancamento(M, { pessoaId: "inexistente", ano: 2027, carteira: "ferias", tipo: "credito", dias: 1, motivo: "pessoa inexistente", criadoPor: "marina", criadoEm: AGORA })).subcodigo,
    "NAO_ENCONTRADO",
  );
  assert.equal(repo.lancamentosDaPessoa(M, "ana").length, 3);
});

test("auditoria omite motivo/justificativa/segredo do detalhe", () => {
  repo.registrarAuditoria(M, {
    em: AGORA, atorId: "carlos", acao: "decidir", entidade: "pedido", entidadeId: 1,
    detalhe: { decisao: "recusar", motivoDecisao: SENTINELA, aninhado: { justificativa: SENTINELA, ok: 1 } },
  });
  const [a] = repo.listarAuditoria(M, { entidade: "pedido", entidadeId: 1 });
  assert.equal(JSON.stringify(a).includes(SENTINELA), false);
  assert.equal(a.detalhe?.decisao, "recusar");
});

test("transacao: fn assincrona e recusada e uma excecao desfaz tudo", () => {
  const antes = contar("auditoria");
  assert.throws(() =>
    repo.emTransacao(() => {
      repo.registrarAuditoria(M, { em: AGORA, acao: "x", entidade: "teste" });
      throw new Error("falha proposital");
    }),
  );
  assert.equal(contar("auditoria"), antes);
  assert.throws(() => repo.emTransacao(() => Promise.resolve(1) as unknown as number), /assincrona/);
  assert.equal(contar("auditoria"), antes);
});

// --- cascata (por ultimo: apaga o portal demo) -------------------------------

test("apagar o portal demo apaga em cascata TODAS as tabelas de ausencias", () => {
  const db = getDb();
  // Garante dados em todas as tabelas (pedido aprovado => pedido_dia + sync_job).
  const s = semana(34);
  const p = repo.criarPedido(M, novo("felipe", "ferias", s.inicio, s.fim));
  repo.decidirPedido(M, { pedidoId: p.id, versao: p.versao, decisao: "aprovar", decididoPor: "carlos", decididoEm: AGORA });
  repo.gravarNotificacao(M, { pessoaId: "felipe", pedidoId: p.id, etapa: "confirmado", texto: "ok", criadaEm: AGORA });
  repo.registrarAuditoria(M, { em: AGORA, atorId: "carlos", acao: "aprovar", entidade: "pedido", entidadeId: p.id });
  for (const t of TABELAS_AUSENCIAS) assert.ok(contar(t) > 0, `${t} deveria ter dados antes da cascata`);

  const portalReal = db.prepare("SELECT * FROM portal WHERE member_id = ?").get("portal-real-exemplo");
  removerPortal(M);

  for (const t of TABELAS_AUSENCIAS) assert.equal(contar(t), 0, `${t} sobreviveu a remocao do portal`);
  for (const t of TABELAS_AUSENCIAS) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n, 0, `${t} tem linhas orfas`);
  }
  assert.deepEqual(db.prepare("SELECT * FROM portal WHERE member_id = ?").get("portal-real-exemplo"), portalReal);
  assert.deepEqual(db.pragma("foreign_key_check"), [], "FK quebrada apos a cascata");

  // Re-semear recria tudo (idempotente apos a remocao).
  assert.equal(semearDemo().executado, true);
  assert.equal(contar("pessoa"), 10);
});

test.after(() => {
  try {
    getDb().close();
  } catch {
    /* ja fechado */
  }
  fs.rmSync(dirTemp, { recursive: true, force: true });
});
