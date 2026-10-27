/**
 * Testes das rotas /api/ausencias/* (BR24-005, C4).
 *
 * Chamam os handlers das rotas direto (sem subir o servidor) contra o provedor
 * em memoria com dados FICTICIOS. Fixam o que ja deu errado em apps assim:
 *  - sessao forjada, papel/pessoa vindo de corpo/query/header;
 *  - mass assignment (status, diasUteis, decididoPor...) => 422 sem efeito;
 *  - recurso de outro dono: 404 (rotas [id]) / 403 e NENHUMA mudanca de estado;
 *  - dado sensivel mascarado para gestor e colegas.
 *
 *   npm run test:api
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-api-"));
process.env.DATABASE_PATH = path.join(dir, "api.db");
process.env.BITRIX_ESCRITA = "0";
const CHAVE = crypto.randomBytes(32).toString("base64");
process.env.APP_ENCRYPTION_KEY = CHAVE;
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.MODO_DEMO = "1";

const { reiniciarDemo } = await import("../src/app/api/ausencias/_servicos.ts");
const { esquecerPreparoDemo } = await import("../src/lib/ausencias/boot.ts");
const { removerPortal } = await import("../src/lib/db/portals.ts");
const { getDb } = await import("../src/lib/db/index.ts");
const { fakeDoProcesso } = await import("../src/lib/bitrix/ausencias/index.ts");
function limparDemo() { removerPortal("demo:ficticio"); esquecerPreparoDemo(); reiniciarDemo(); fakeDoProcesso().reiniciar(); }
after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });
const { reiniciarLimiteDeTaxa, COOKIE_SESSAO, SELO_DEMO } = await import("../src/app/api/ausencias/_sessao.ts");

const rSessao = await import("../src/app/api/ausencias/sessao-demo/route.ts");
const rEu = await import("../src/app/api/ausencias/eu/route.ts");
const rTipos = await import("../src/app/api/ausencias/tipos/route.ts");
const rPrevia = await import("../src/app/api/ausencias/previa/route.ts");
const rPedidos = await import("../src/app/api/ausencias/pedidos/route.ts");
const rParaAprovar = await import("../src/app/api/ausencias/pedidos/para-aprovar/route.ts");
const rPedido = await import("../src/app/api/ausencias/pedidos/[id]/route.ts");
const rDecisao = await import("../src/app/api/ausencias/pedidos/[id]/decisao/route.ts");
const rCancelar = await import("../src/app/api/ausencias/pedidos/[id]/cancelar/route.ts");
const rImpacto = await import("../src/app/api/ausencias/pedidos/[id]/impacto/route.ts");
const rLembrar = await import("../src/app/api/ausencias/pedidos/[id]/lembrar/route.ts");
const rSaldos = await import("../src/app/api/ausencias/saldos/route.ts");
const rCreditar = await import("../src/app/api/ausencias/creditar/route.ts");
const rCalendario = await import("../src/app/api/ausencias/calendario/route.ts");
const rDisponibilidade = await import("../src/app/api/ausencias/disponibilidade/route.ts");
const rPainel = await import("../src/app/api/ausencias/painel/route.ts");
const rNotificacoes = await import("../src/app/api/ausencias/notificacoes/route.ts");
const rEtapas = await import("../src/app/api/ausencias/etapas/route.ts");
const rEquipes = await import("../src/app/api/ausencias/equipes/route.ts");
const rMinimo = await import("../src/app/api/ausencias/equipes/[id]/minimo/route.ts");
const rLog = await import("../src/app/api/ausencias/sincronizacao/route.ts");
const rReprocessar = await import("../src/app/api/ausencias/sincronizacao/reprocessar/route.ts");

interface Ctx {
  params: Promise<{ id: string }>;
}
type Handler = (req: Request, ctx: Ctx) => Promise<Response> | Response;
interface Envelope {
  ok: boolean;
  dados?: unknown;
  erro?: { codigo: string; mensagem: string; campos?: Record<string, string> };
}
interface Opcoes {
  corpo?: unknown;
  /** Corpo cru (para JSON invalido). */
  bruto?: string;
  cookie?: string;
  headers?: Record<string, string>;
}
interface Resultado {
  status: number;
  env: Envelope;
  texto: string;
  res: Response;
}

const BASE = "http://localhost:3000/api/ausencias";

async function chamar(handler: Handler, metodo: string, caminho: string, op: Opcoes = {}, id = "1"): Promise<Resultado> {
  const headers: Record<string, string> = { ...(op.headers ?? {}) };
  if (op.cookie) headers.cookie = op.cookie;
  let body: string | undefined;
  if (op.bruto !== undefined) body = op.bruto;
  else if (op.corpo !== undefined) {
    body = JSON.stringify(op.corpo);
    headers["content-type"] = "application/json";
  }
  const req = new Request(`${BASE}${caminho}`, { method: metodo, headers, body });
  const res = await handler(req, { params: Promise.resolve({ id }) });
  const texto = await res.clone().text();
  return { status: res.status, env: JSON.parse(texto) as Envelope, texto, res };
}

async function entrarComo(pessoaId: string): Promise<string> {
  const r = await chamar(rSessao.POST, "POST", "/sessao-demo", { corpo: { pessoaId } });
  assert.equal(r.status, 200, `entrar como ${pessoaId}: ${r.texto}`);
  const set = r.res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_SESSAO}=`));
  assert.ok(set, "cookie de sessao ausente");
  return set.split(";")[0];
}

interface PedidoJson {
  id: number;
  status: string;
  versao: number;
  tipo: string;
  diasUteis: number;
  justificativa?: string;
  motivoPrivado?: string;
  excedeSaldo: boolean;
  pessoa: { id: string };
  permitido: { cancelar: boolean; decidir: boolean };
}

async function meusPedidos(cookie: string): Promise<PedidoJson[]> {
  const r = await chamar(rPedidos.GET, "GET", "/pedidos", { cookie });
  assert.equal(r.status, 200);
  return r.env.dados as PedidoJson[];
}

async function pedidoDe(cookie: string, filtro: (p: PedidoJson) => boolean): Promise<PedidoJson> {
  const p = (await meusPedidos(cookie)).find(filtro);
  assert.ok(p, "pedido de semente nao encontrado");
  return p;
}

async function visaoAdmin(id: number): Promise<string> {
  const cookie = await entrarComo("marina");
  return (await chamar(rPedido.GET, "GET", `/pedidos/${id}`, { cookie }, String(id))).texto;
}

beforeEach(() => {
  limparDemo();
  reiniciarLimiteDeTaxa();
  process.env.MODO_DEMO = "1";
});

/* ------------------------------------------------------------------ sessao */

describe("sessao-demo", () => {
  test("aceita so pessoaId, emite cookie httpOnly e mostra o selo fixo", async () => {
    const r = await chamar(rSessao.POST, "POST", "/sessao-demo", { corpo: { pessoaId: "ana" } });
    assert.equal(r.status, 200);
    const set = r.res.headers.getSetCookie().join("\n");
    assert.match(set, /httponly/i);
    assert.match(set, /samesite=lax/i);
    assert.equal((r.env.dados as { selo: string }).selo, SELO_DEMO);
    assert.equal(SELO_DEMO, "Modo demonstração — identidade não verificada");
    // O cookie nao carrega papel: so pessoaId + validade.
    const payload = Buffer.from(set.split("=")[1].split(".")[0], "base64url").toString("utf8");
    assert.deepEqual(Object.keys(JSON.parse(payload) as object).sort(), ["e", "p"]);
  });

  test("campo extra (papel, status...) no corpo = 422 e nenhum cookie", async () => {
    for (const extra of [{ papel: "admin" }, { admin: true }, { status: "aprovada" }]) {
      const r = await chamar(rSessao.POST, "POST", "/sessao-demo", { corpo: { pessoaId: "ana", ...extra } });
      assert.equal(r.status, 422);
      assert.equal(r.res.headers.getSetCookie().length, 0);
    }
  });

  test("pessoa inexistente e JSON invalido = 422 sem cookie", async () => {
    const a = await chamar(rSessao.POST, "POST", "/sessao-demo", { corpo: { pessoaId: "fantasma" } });
    assert.equal(a.status, 422);
    const b = await chamar(rSessao.POST, "POST", "/sessao-demo", { bruto: "{nao e json" });
    assert.equal(b.status, 422);
    assert.equal(b.res.headers.getSetCookie().length, 0);
  });

  test("MODO_DEMO desligado: nao cria sessao (404) e nenhuma rota autentica (401)", async () => {
    const cookie = await entrarComo("marina");
    process.env.MODO_DEMO = "0";
    const entrar = await chamar(rSessao.POST, "POST", "/sessao-demo", { corpo: { pessoaId: "ana" } });
    assert.equal(entrar.status, 404);
    const ctx = await chamar(rSessao.GET, "GET", "/sessao-demo");
    assert.equal((ctx.env.dados as { modoDemo: boolean; pessoas: unknown[] }).modoDemo, false);
    assert.deepEqual((ctx.env.dados as { pessoas: unknown[] }).pessoas, []);
    const eu = await chamar(rEu.GET, "GET", "/eu", { cookie });
    assert.equal(eu.status, 401);
  });

  test("POST vindo de outra origem e recusado", async () => {
    const r = await chamar(rSessao.POST, "POST", "/sessao-demo", {
      corpo: { pessoaId: "ana" },
      headers: { origin: "https://site-malicioso.example", host: "localhost:3000" },
    });
    assert.equal(r.status, 403);
    assert.equal(r.res.headers.getSetCookie().length, 0);
  });

  test("DELETE apaga o cookie", async () => {
    const r = await chamar(rSessao.DELETE, "DELETE", "/sessao-demo");
    assert.equal(r.status, 200);
    assert.match(r.res.headers.getSetCookie().join("\n"), /max-age=0/i);
  });
});

/* ---------------------------------------------------------- sessao forjada */

describe("sessao forjada", () => {
  const ROTAS_GET: [string, Handler][] = [
    ["/eu", rEu.GET],
    ["/tipos", rTipos.GET],
    ["/pedidos", rPedidos.GET],
    ["/pedidos/para-aprovar", rParaAprovar.GET],
    ["/pedidos/1", rPedido.GET],
    ["/pedidos/1/impacto", rImpacto.GET],
    ["/saldos", rSaldos.GET],
    ["/calendario?equipeId=tec&de=2026-11-01&ate=2026-11-30", rCalendario.GET],
    ["/disponibilidade?equipeId=tec&de=2026-11-01&ate=2026-11-30", rDisponibilidade.GET],
    ["/painel", rPainel.GET],
    ["/notificacoes", rNotificacoes.GET],
    ["/etapas", rEtapas.GET],
    ["/equipes", rEquipes.GET],
    ["/sincronizacao", rLog.GET],
  ];

  test("sem cookie: toda rota responde 401", async () => {
    for (const [caminho, h] of ROTAS_GET) {
      const r = await chamar(h, "GET", caminho);
      assert.equal(r.status, 401, caminho);
      assert.equal(r.env.ok, false);
    }
    const escritas: [Handler, string, string, unknown][] = [
      [rPrevia.POST, "POST", "/previa", { tipoId: "ferias", inicio: "2026-12-01", fim: "2026-12-02" }],
      [rPedidos.POST, "POST", "/pedidos", { tipoId: "ferias", inicio: "2026-12-01", fim: "2026-12-02" }],
      [rDecisao.POST, "POST", "/pedidos/1/decisao", { decisao: "aprovar", versao: 1 }],
      [rCancelar.POST, "POST", "/pedidos/1/cancelar", {}],
      [rLembrar.POST, "POST", "/pedidos/1/lembrar", {}],
      [rCreditar.POST, "POST", "/creditar", { pessoaId: "ana", carteira: "ferias", dias: 1, motivo: "motivo de teste ok" }],
      [rEtapas.PUT, "PUT", "/etapas", { chave: "enviado", rotulo: "Enviado", mensagem: "Oi {nome}" }],
      [rMinimo.PUT, "PUT", "/equipes/tec/minimo", { minimoPessoas: 1, contarPendentes: false }],
      [rReprocessar.POST, "POST", "/sincronizacao/reprocessar", {}],
    ];
    for (const [h, m, c, corpo] of escritas) {
      const r = await chamar(h, m, c, { corpo });
      assert.equal(r.status, 401, `${m} ${c}`);
    }
  });

  test("cookie com assinatura adulterada, truncado ou de outra chave = 401", async () => {
    const valido = await entrarComo("ana");
    const [nome, valor] = [valido.split("=")[0], valido.split("=")[1]];
    const [payload, sig] = valor.split(".");
    const adulterada = `${nome}=${payload}.${sig.slice(0, -2)}AA`;
    const truncada = `${nome}=${payload}`;
    const outraChave = crypto.createHmac("sha256", "outra-chave").update(payload).digest("base64url");
    for (const cookie of [adulterada, truncada, `${nome}=${payload}.${outraChave}`, `${nome}=lixo`]) {
      const r = await chamar(rEu.GET, "GET", "/eu", { cookie });
      assert.equal(r.status, 401, cookie);
    }
  });

  test("trocar o pessoaId do payload mantendo a assinatura de outro = 401", async () => {
    const ana = await entrarComo("ana");
    const [nome, valor] = [ana.split("=")[0], ana.split("=")[1]];
    const sig = valor.split(".")[1];
    const forjado = Buffer.from(JSON.stringify({ p: "marina", e: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const r = await chamar(rEtapas.PUT, "PUT", "/etapas", {
      cookie: `${nome}=${forjado}.${sig}`,
      corpo: { chave: "enviado", rotulo: "Hackeado", mensagem: "x {nome}" },
    });
    assert.equal(r.status, 401);
    const etapas = await chamar(rEtapas.GET, "GET", "/etapas", { cookie: await entrarComo("ana") });
    assert.ok(!etapas.texto.includes("Hackeado"));
  });

  test("cookie assinado corretamente, mas vencido = 401", async () => {
    const baseChave = crypto.createHmac("sha256", CHAVE).update("ausencias.sessao-demo.v1").digest();
    const payload = Buffer.from(JSON.stringify({ p: "ana", e: Math.floor(Date.now() / 1000) - 10 })).toString("base64url");
    const sig = crypto.createHmac("sha256", baseChave).update(payload).digest("base64url");
    const r = await chamar(rEu.GET, "GET", "/eu", { cookie: `${COOKIE_SESSAO}=${payload}.${sig}` });
    assert.equal(r.status, 401);
  });

  test("cookie valido de pessoa que nao existe mais = 401", async () => {
    const baseChave = crypto.createHmac("sha256", CHAVE).update("ausencias.sessao-demo.v1").digest();
    const payload = Buffer.from(JSON.stringify({ p: "fantasma", e: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
    const sig = crypto.createHmac("sha256", baseChave).update(payload).digest("base64url");
    const r = await chamar(rEu.GET, "GET", "/eu", { cookie: `${COOKIE_SESSAO}=${payload}.${sig}` });
    assert.equal(r.status, 401);
  });

  test("pessoaId/papel em header e query sao ignorados: a sessao continua sendo a do cookie", async () => {
    const ana = await entrarComo("ana");
    const r = await chamar(rEu.GET, "GET", "/eu?pessoaId=marina&papel=admin", {
      cookie: ana,
      headers: { "x-pessoa-id": "marina", "x-papel": "admin", "x-user-id": "marina" },
    });
    assert.equal(r.status, 200);
    assert.equal((r.env.dados as { id: string; papel: string }).id, "ana");
    assert.equal((r.env.dados as { id: string; papel: string }).papel, "colaborador");

    const painel = await chamar(rPainel.GET, "GET", "/painel?pessoaId=marina&papel=admin", {
      cookie: ana,
      headers: { "x-papel": "admin" },
    });
    assert.equal(painel.status, 403);
  });

  test("pessoaId/papel no corpo = 422 e nada muda", async () => {
    const ana = await entrarComo("ana");
    const antes = (await meusPedidos(ana)).length;
    for (const extra of [{ pessoaId: "bruno" }, { papel: "admin" }, { aprovadorId: "ana" }]) {
      const r = await chamar(rPedidos.POST, "POST", "/pedidos", {
        cookie: ana,
        corpo: { tipoId: "folga", inicio: "2026-12-01", fim: "2026-12-01", ...extra },
      });
      assert.equal(r.status, 422, JSON.stringify(extra));
    }
    assert.equal((await meusPedidos(ana)).length, antes);
    assert.equal((await meusPedidos(await entrarComo("bruno"))).length, 1);
  });

  test("nenhuma resposta vaza a chave da aplicacao", async () => {
    const cookie = await entrarComo("marina");
    for (const [caminho, h] of ROTAS_GET) {
      const r = await chamar(h, "GET", caminho, { cookie });
      assert.ok(!r.texto.includes(CHAVE), caminho);
    }
  });
});

/* -------------------------------------------------------- mass assignment */

describe("mass assignment", () => {
  const BASE_PEDIDO = { tipoId: "outro", inicio: "2026-12-10", fim: "2026-12-11" };

  test("POST /pedidos: status, diasUteis, excedeSaldo, decididoPor, versao... = 422 e nenhum pedido criado", async () => {
    const ana = await entrarComo("ana");
    const antes = (await meusPedidos(ana)).length;
    const extras: Record<string, unknown>[] = [
      { status: "aprovada" },
      { diasUteis: 0 },
      { excedeSaldo: false },
      { decididoPor: "ana" },
      { versao: 99 },
      { sincronizacao: "ok" },
      { id: 1 },
      { prazoEm: "2030-01-01T00:00:00.000Z" },
    ];
    for (const extra of extras) {
      const r = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { ...BASE_PEDIDO, ...extra } });
      assert.equal(r.status, 422, JSON.stringify(extra));
      assert.equal(r.env.erro?.codigo, "VALIDACAO");
    }
    assert.equal((await meusPedidos(ana)).length, antes);
  });

  test("POST /previa tambem e estrito", async () => {
    const ana = await entrarComo("ana");
    const r = await chamar(rPrevia.POST, "POST", "/previa", { cookie: ana, corpo: { ...BASE_PEDIDO, diasUteis: 1 } });
    assert.equal(r.status, 422);
  });

  test("diasUteis e status do pedido criado sao calculados no servidor", async () => {
    const ana = await entrarComo("ana");
    // 10/12/2026 = quinta, 11 = sexta: 2 dias uteis; fim de semana nao conta.
    const r = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { tipoId: "outro", inicio: "2026-12-10", fim: "2026-12-14" } });
    assert.equal(r.status, 200, r.texto);
    const p = r.env.dados as PedidoJson;
    assert.equal(p.diasUteis, 3);
    assert.equal(p.status, "pendente");
    assert.equal(p.pessoa.id, "ana");
  });

  test("decisao: status/decididoPor/pessoaId no corpo = 422 e o pedido segue pendente", async () => {
    const ana = await entrarComo("ana");
    const carlos = await entrarComo("carlos");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    for (const extra of [{ status: "aprovada" }, { decididoPor: "carlos" }, { pessoaId: "carlos" }, { diasUteis: 1 }]) {
      const r = await chamar(rDecisao.POST, "POST", `/pedidos/${alvo.id}/decisao`, { cookie: carlos, corpo: { decisao: "aprovar", versao: alvo.versao, ...extra } }, String(alvo.id));
      assert.equal(r.status, 422, JSON.stringify(extra));
    }
    const depois = await pedidoDe(ana, (p) => p.id === alvo.id);
    assert.equal(depois.status, "pendente");
    assert.equal(depois.versao, alvo.versao);
  });

  test("acoes sem parametros (cancelar, lembrar, reprocessar) rejeitam campos extras", async () => {
    const ana = await entrarComo("ana");
    const marina = await entrarComo("marina");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    const a = await chamar(rCancelar.POST, "POST", `/pedidos/${alvo.id}/cancelar`, { cookie: ana, corpo: { status: "aprovada" } }, String(alvo.id));
    assert.equal(a.status, 422);
    const b = await chamar(rLembrar.POST, "POST", `/pedidos/${alvo.id}/lembrar`, { cookie: marina, corpo: { pessoaId: "x" } }, String(alvo.id));
    assert.equal(b.status, 422);
    const c = await chamar(rReprocessar.POST, "POST", "/sincronizacao/reprocessar", { cookie: marina, corpo: { estado: "ok" } });
    assert.equal(c.status, 422);
    assert.equal((await pedidoDe(ana, (p) => p.id === alvo.id)).status, "pendente");
  });

  test("etapas e minimo: campos desconhecidos e variaveis nao permitidas = 422", async () => {
    const marina = await entrarComo("marina");
    const a = await chamar(rEtapas.PUT, "PUT", "/etapas", { cookie: marina, corpo: { chave: "enviado", rotulo: "Enviado", mensagem: "Oi {nome}", quemAge: "admin" } });
    assert.equal(a.status, 422);
    const b = await chamar(rEtapas.PUT, "PUT", "/etapas", { cookie: marina, corpo: { chave: "enviado", rotulo: "Enviado", mensagem: "Oi {gestor}, veja {motivo}" } });
    assert.equal(b.status, 422);
    const c = await chamar(rMinimo.PUT, "PUT", "/equipes/tec/minimo", { cookie: marina, corpo: { minimoPessoas: 3, contarPendentes: false, gestorId: "ana" } }, "tec");
    assert.equal(c.status, 422);
    const equipes = (await chamar(rEquipes.GET, "GET", "/equipes", { cookie: marina })).env.dados as { id: string; minimoPessoas: number; gestorId: string }[];
    assert.equal(equipes.find((e) => e.id === "tec")?.minimoPessoas, 5);
    assert.equal(equipes.find((e) => e.id === "tec")?.gestorId, "carlos");
  });
});

/* ------------------------------------- matriz rota x perfil x outro dono */

describe("recurso de outro dono: 404 nas rotas [id], 403 nas demais, sem mudanca", () => {
  test("rotas [id] do pedido da Ana: quem nao e dono nem superior recebe 404 e nada muda", async () => {
    const ana = await entrarComo("ana");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    const antes = await visaoAdmin(alvo.id);
    const id = String(alvo.id);

    // Outro colaborador da equipe, colaborador de outra equipe, gestor de outra equipe.
    const intrusos = ["bruno", "paula", "rafael", "vinicius", "gabriel"];
    const rotas: [string, Handler, string, string, unknown][] = [
      ["ver", rPedido.GET, "GET", `/pedidos/${id}`, undefined],
      ["impacto", rImpacto.GET, "GET", `/pedidos/${id}/impacto`, undefined],
      ["decidir", rDecisao.POST, "POST", `/pedidos/${id}/decisao`, { decisao: "aprovar", versao: alvo.versao }],
      ["recusar", rDecisao.POST, "POST", `/pedidos/${id}/decisao`, { decisao: "recusar", versao: alvo.versao, motivoDecisao: "motivo qualquer ok" }],
      ["cancelar", rCancelar.POST, "POST", `/pedidos/${id}/cancelar`, {}],
      ["lembrar", rLembrar.POST, "POST", `/pedidos/${id}/lembrar`, {}],
    ];
    for (const quem of intrusos) {
      const cookie = await entrarComo(quem);
      for (const [nome, h, metodo, caminho, corpo] of rotas) {
        const r = await chamar(h, metodo, caminho, { cookie, corpo }, id);
        assert.equal(r.status, 404, `${quem} ${nome}`);
        assert.equal(r.env.ok, false);
      }
    }
    assert.equal(await visaoAdmin(alvo.id), antes, "o pedido nao pode ter mudado");
    // Nenhuma notificacao foi criada para a Ana alem da semente.
    const notif = (await chamar(rNotificacoes.GET, "GET", "/notificacoes", { cookie: ana })).env.dados as unknown[];
    assert.equal(notif.length, 1);
  });

  test("a dona, o gestor da equipe e o admin enxergam o mesmo pedido (200)", async () => {
    const ana = await entrarComo("ana");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    for (const quem of ["ana", "carlos", "marina"]) {
      const r = await chamar(rPedido.GET, "GET", `/pedidos/${alvo.id}`, { cookie: await entrarComo(quem) }, String(alvo.id));
      assert.equal(r.status, 200, quem);
    }
  });

  test("ninguem decide o proprio pedido (nem gestor, nem admin): 404", async () => {
    const carlos = await entrarComo("carlos");
    const dele = await pedidoDe(carlos, (p) => p.status === "pendente");
    const a = await chamar(rDecisao.POST, "POST", `/pedidos/${dele.id}/decisao`, { cookie: carlos, corpo: { decisao: "aprovar", versao: dele.versao } }, String(dele.id));
    assert.equal(a.status, 404);

    const marina = await entrarComo("marina");
    const dela = await pedidoDe(marina, (p) => p.status === "pendente");
    const b = await chamar(rDecisao.POST, "POST", `/pedidos/${dela.id}/decisao`, { cookie: marina, corpo: { decisao: "aprovar", versao: dela.versao } }, String(dela.id));
    assert.equal(b.status, 404);
    // O colaborador tambem nao decide o proprio.
    const ana = await entrarComo("ana");
    const propria = await pedidoDe(ana, (p) => p.status === "pendente");
    const c = await chamar(rDecisao.POST, "POST", `/pedidos/${propria.id}/decisao`, { cookie: ana, corpo: { decisao: "aprovar", versao: propria.versao } }, String(propria.id));
    assert.equal(c.status, 404);
    assert.equal((await pedidoDe(ana, (p) => p.id === propria.id)).status, "pendente");
  });

  test("outro gestor aprova pedido de gestor so sendo o aprovador direto (Renata sim, Rafael nao)", async () => {
    const carlos = await entrarComo("carlos");
    const dele = await pedidoDe(carlos, (p) => p.status === "pendente");
    const rafael = await entrarComo("rafael");
    const r1 = await chamar(rDecisao.POST, "POST", `/pedidos/${dele.id}/decisao`, { cookie: rafael, corpo: { decisao: "aprovar", versao: dele.versao } }, String(dele.id));
    assert.equal(r1.status, 404);
    const renata = await entrarComo("renata");
    const r2 = await chamar(rDecisao.POST, "POST", `/pedidos/${dele.id}/decisao`, { cookie: renata, corpo: { decisao: "aprovar", versao: dele.versao } }, String(dele.id));
    assert.equal(r2.status, 200, r2.texto);
    assert.equal((r2.env.dados as PedidoJson).status, "aprovada");
  });

  test("ids invalidos em rota [id] = 404 (nunca 500)", async () => {
    const ana = await entrarComo("ana");
    for (const id of ["abc", "0", "-3", "1.5", "99999", "1;drop"]) {
      for (const [h, metodo, caminho] of [
        [rPedido.GET, "GET", "/pedidos/x"],
        [rImpacto.GET, "GET", "/pedidos/x/impacto"],
      ] as [Handler, string, string][]) {
        const r = await chamar(h, metodo, caminho, { cookie: ana }, id);
        assert.equal(r.status, 404, `${caminho} ${id}`);
      }
    }
  });

  test("rotas administrativas: matriz perfil x rota", async () => {
    // [rota, handler, metodo, caminho, corpo, perfis negados (403), perfis liberados (200)]
    // (rotas sem [id]: negado = 403; as rotas [id] ficam no teste anterior, com 404)
    const casos: [string, Handler, string, string, unknown, string[], string[]][] = [
      ["painel", rPainel.GET, "GET", "/painel", undefined, ["ana"], ["carlos", "marina"]],
      ["log de sincronizacao", rLog.GET, "GET", "/sincronizacao", undefined, ["ana", "carlos"], ["marina"]],
      ["reprocessar", rReprocessar.POST, "POST", "/sincronizacao/reprocessar", {}, ["ana", "carlos"], ["marina"]],
      ["editar etapa", rEtapas.PUT, "PUT", "/etapas", { chave: "enviado", rotulo: "Enviado!", mensagem: "Oi {nome}" }, ["ana", "carlos"], ["marina"]],
      ["calendario", rCalendario.GET, "GET", "/calendario?equipeId=tec&de=2026-11-01&ate=2026-11-30", undefined, ["ana", "rafael"], ["carlos", "marina"]],
      ["disponibilidade", rDisponibilidade.GET, "GET", "/disponibilidade?equipeId=tec&de=2026-11-01&ate=2026-11-30", undefined, ["ana", "rafael"], ["carlos", "marina"]],
      ["minimo", rMinimo.PUT, "PUT", "/equipes/tec/minimo", { minimoPessoas: 4, contarPendentes: true }, ["ana", "rafael", "bruno"], ["carlos", "marina"]],
    ];
    for (const [nome, h, metodo, caminho, corpo, negados] of casos) {
      for (const quem of negados) {
        const r = await chamar(h, metodo, caminho, { cookie: await entrarComo(quem), corpo }, "tec");
        assert.equal(r.status, 403, `${nome} / ${quem}`);
      }
    }
    // Nada mudou apos as negacoes (etapas e minimo da equipe).
    const marina = await entrarComo("marina");
    const etapas = (await chamar(rEtapas.GET, "GET", "/etapas", { cookie: marina })).texto;
    assert.ok(!etapas.includes("Enviado!"));
    const equipes = (await chamar(rEquipes.GET, "GET", "/equipes", { cookie: marina })).env.dados as { id: string; minimoPessoas: number; contarPendentes: boolean }[];
    assert.deepEqual(equipes.find((e) => e.id === "tec"), { id: "tec", nome: "Tecnologia", gestorId: "carlos", minimoPessoas: 5, contarPendentes: false });
    // Os liberados passam (cada um em estado limpo para nao depender da ordem).
    for (const [nome, h, metodo, caminho, corpo, , liberados2] of casos) {
      for (const quem of liberados2) {
        limparDemo();
        const r = await chamar(h, metodo, caminho, { cookie: await entrarComo(quem), corpo }, "tec");
        assert.equal(r.status, 200, `${nome} / ${quem}: ${r.texto}`);
      }
    }
  });

  test("gestor nao ve calendario/disponibilidade/minimo de outra equipe (403) nem equipe inexistente (404)", async () => {
    const carlos = await entrarComo("carlos");
    const jan = "&de=2026-11-01&ate=2026-11-30";
    for (const [h, rota] of [
      [rCalendario.GET, "/calendario"],
      [rDisponibilidade.GET, "/disponibilidade"],
    ] as [Handler, string][]) {
      assert.equal((await chamar(h, "GET", `${rota}?equipeId=comercial${jan}`, { cookie: carlos })).status, 403, rota);
      assert.equal((await chamar(h, "GET", `${rota}?equipeId=nao-existe${jan}`, { cookie: carlos })).status, 404, rota);
    }
    const r = await chamar(rMinimo.PUT, "PUT", "/equipes/comercial/minimo", { cookie: carlos, corpo: { minimoPessoas: 1, contarPendentes: false } }, "comercial");
    assert.equal(r.status, 403);
    const equipes = (await chamar(rEquipes.GET, "GET", "/equipes", { cookie: await entrarComo("marina") })).env.dados as { id: string; minimoPessoas: number }[];
    assert.equal(equipes.find((e) => e.id === "comercial")?.minimoPessoas, 3);
  });

  test("janela invalida de calendario = 422 (nunca 500)", async () => {
    const carlos = await entrarComo("carlos");
    for (const q of ["equipeId=tec&de=2026-13-45&ate=2026-11-30", "equipeId=tec&de=2026-11-30&ate=2026-11-01", "equipeId=tec&de=2026-01-01&ate=2027-12-31", "de=2026-11-01&ate=2026-11-30"]) {
      const r = await chamar(rCalendario.GET, "GET", `/calendario?${q}`, { cookie: carlos });
      assert.equal(r.status, 422, q);
    }
  });

  test("creditar dias: colaborador 403; ninguem credita a si; gestor so a quem supervisiona", async () => {
    const corpo = { carteira: "ferias", dias: 3, motivo: "compensacao de hora extra" };
    const saldoBruno = async () => {
      const r = await chamar(rSaldos.GET, "GET", "/saldos", { cookie: await entrarComo("bruno") });
      return (r.env.dados as { carteira: string; disponivel: number }[]).find((s) => s.carteira === "ferias")?.disponivel;
    };
    const antes = await saldoBruno();
    const negados: [string, string][] = [
      ["ana", "bruno"], // colaborador
      ["carlos", "carlos"], // a si mesmo
      ["marina", "marina"], // admin a si mesmo
      ["carlos", "paula"], // gestor de outra equipe
      ["rafael", "bruno"], // idem
    ];
    for (const [quem, alvo] of negados) {
      const r = await chamar(rCreditar.POST, "POST", "/creditar", { cookie: await entrarComo(quem), corpo: { pessoaId: alvo, ...corpo } });
      assert.equal(r.status, 403, `${quem} -> ${alvo}`);
    }
    assert.equal(await saldoBruno(), antes, "saldo nao pode mudar");
    const ok = await chamar(rCreditar.POST, "POST", "/creditar", { cookie: await entrarComo("carlos"), corpo: { pessoaId: "bruno", ...corpo } });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(await saldoBruno(), (antes ?? 0) + 3);
  });
});

/* ---------------------------------------------------------- dado sensivel */

describe("dado sensivel", () => {
  test("gestor e colega veem 'Ausência' sem motivo; a dona e o admin veem o tipo real", async () => {
    const elisa = await entrarComo("elisa");
    const dela = await pedidoDe(elisa, (p) => p.tipo === "Licença por doença");
    assert.equal(dela.motivoPrivado, "Procedimento agendado (texto fictício)");

    const id = String(dela.id);
    const carlos = await chamar(rPedido.GET, "GET", `/pedidos/${id}`, { cookie: await entrarComo("carlos") }, id);
    assert.equal(carlos.status, 200);
    const visto = carlos.env.dados as PedidoJson;
    assert.equal(visto.tipo, "Ausência");
    assert.equal(visto.motivoPrivado, undefined);
    assert.equal(visto.justificativa, undefined);
    assert.ok(!carlos.texto.includes("Procedimento"));
    assert.ok(!carlos.texto.toLowerCase().includes("doença"));

    const marina = await chamar(rPedido.GET, "GET", `/pedidos/${id}`, { cookie: await entrarComo("marina") }, id);
    assert.equal((marina.env.dados as PedidoJson).tipo, "Licença por doença");
    assert.equal((marina.env.dados as PedidoJson).motivoPrivado, "Procedimento agendado (texto fictício)");

    // Colega nao ve o pedido (404), e o calendario nem existe para colaborador (403).
    const bruno = await chamar(rPedido.GET, "GET", `/pedidos/${id}`, { cookie: await entrarComo("bruno") }, id);
    assert.equal(bruno.status, 404);
  });

  test("calendario, disponibilidade e painel nao revelam o tipo sensivel nem o motivo", async () => {
    const carlos = await entrarComo("carlos");
    const cal = await chamar(rCalendario.GET, "GET", "/calendario?equipeId=tec&de=2026-12-01&ate=2026-12-31", { cookie: carlos });
    assert.equal(cal.status, 200);
    const ausencias = (cal.env.dados as { ausencias: { pessoaId: string; rotulo: string; cor: string }[] }).ausencias;
    const elisa = ausencias.find((a) => a.pessoaId === "elisa");
    assert.ok(elisa);
    assert.equal(elisa.rotulo, "Ausência");
    assert.notEqual(elisa.cor.toUpperCase(), "#F2A27E", "a cor do tipo revelaria a licenca");
    const disp = await chamar(rDisponibilidade.GET, "GET", "/disponibilidade?equipeId=tec&de=2026-12-01&ate=2026-12-31", { cookie: carlos });
    const painel = await chamar(rPainel.GET, "GET", "/painel", { cookie: await entrarComo("marina") });
    for (const r of [cal, disp, painel]) {
      assert.ok(!/doen[cç]a|maternidade|Procedimento|F2A27E/i.test(r.texto), r.texto.slice(0, 120));
    }
  });

  test("tipo sensivel rejeita justificativa (422); tipo comum rejeita motivoPrivado (422)", async () => {
    const ana = await entrarComo("ana");
    const a = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { tipoId: "doenca", inicio: "2026-12-01", fim: "2026-12-02", justificativa: "estou com problema de saude" } });
    assert.equal(a.status, 422);
    assert.ok(a.env.erro?.campos?.justificativa);
    const b = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { tipoId: "outro", inicio: "2026-12-01", fim: "2026-12-02", motivoPrivado: "x" } });
    assert.equal(b.status, 422);
    const c = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { tipoId: "doenca", inicio: "2026-12-01", fim: "2026-12-02", motivoPrivado: "consulta reservada" } });
    assert.equal(c.status, 200, c.texto);
    // O gestor ve o pedido da Ana como "Ausência" e sem o motivo.
    const id = String((c.env.dados as PedidoJson).id);
    const g = await chamar(rPedido.GET, "GET", `/pedidos/${id}`, { cookie: await entrarComo("carlos") }, id);
    assert.ok(!g.texto.includes("consulta reservada"));
    assert.equal((g.env.dados as PedidoJson).tipo, "Ausência");
  });

  test("notificacoes de decisao nao carregam o motivo da recusa nem do tipo sensivel", async () => {
    const ana = await entrarComo("ana");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    const motivo = "MOTIVO-SECRETO-DA-RECUSA";
    const r = await chamar(rDecisao.POST, "POST", `/pedidos/${alvo.id}/decisao`, { cookie: await entrarComo("carlos"), corpo: { decisao: "recusar", versao: alvo.versao, motivoDecisao: motivo } }, String(alvo.id));
    assert.equal(r.status, 200, r.texto);
    const notif = await chamar(rNotificacoes.GET, "GET", "/notificacoes", { cookie: ana });
    assert.ok(!notif.texto.includes(motivo));
    assert.match(notif.texto, /não foi aprovado/);
    // A dona ve o motivo no proprio pedido (quem decidiu informou para ela).
    const vistoPorAna = await chamar(rPedido.GET, "GET", `/pedidos/${alvo.id}`, { cookie: ana }, String(alvo.id));
    assert.match(vistoPorAna.texto, new RegExp(motivo));
  });
});

/* --------------------------------------------------------- fluxo do pedido */

describe("fluxo de pedido", () => {
  test("previa nao grava; pedir debita saldo; sobreposicao = 409; conflito de equipe nao bloqueia", async () => {
    const ana = await entrarComo("ana");
    const saldoAntes = async () => {
      const r = await chamar(rSaldos.GET, "GET", "/saldos", { cookie: ana });
      return (r.env.dados as { carteira: string; disponivel: number }[]).find((s) => s.carteira === "ferias")?.disponivel as number;
    };
    const inicial = await saldoAntes();

    const previa = await chamar(rPrevia.POST, "POST", "/previa", { cookie: ana, corpo: { tipoId: "ferias", inicio: "2027-01-11", fim: "2027-01-15" } });
    assert.equal(previa.status, 200, previa.texto);
    const p = previa.env.dados as { diasUteis: number; saldoDepois: number; excedeSaldo: boolean; aprovador: { id: string } };
    assert.equal(p.diasUteis, 5);
    assert.equal(p.aprovador.id, "carlos");
    assert.equal(await saldoAntes(), inicial, "previa nao pode gravar");
    assert.equal((await meusPedidos(ana)).length, 3);

    const criado = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { tipoId: "ferias", inicio: "2027-01-11", fim: "2027-01-15" } });
    assert.equal(criado.status, 200, criado.texto);
    assert.equal(await saldoAntes(), inicial - 5);

    const choque = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { tipoId: "outro", inicio: "2027-01-13", fim: "2027-01-14" } });
    assert.equal(choque.status, 409);
    assert.equal((await meusPedidos(ana)).length, 4, "sobreposicao nao cria pedido");

    // 17-19/11: Bruno e Diego ja estao fora; o pedido da Ana (16-27/11) ja existe e o de Elisa/Felipe pode entrar: conflito informa, nao bloqueia.
    const felipe = await entrarComo("felipe");
    const emConflito = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: felipe, corpo: { tipoId: "outro", inicio: "2026-11-18", fim: "2026-11-18" } });
    assert.equal(emConflito.status, 200, emConflito.texto);
  });

  test("saldo insuficiente exige justificativa (422 com campo) e marca excedeSaldo quando informada", async () => {
    const ana = await entrarComo("ana");
    const sem = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo: { tipoId: "ferias", inicio: "2027-03-01", fim: "2027-04-30" } });
    assert.equal(sem.status, 422);
    assert.ok(sem.env.erro?.campos?.justificativa);
    const com = await chamar(rPedidos.POST, "POST", "/pedidos", {
      cookie: ana,
      corpo: { tipoId: "ferias", inicio: "2027-03-01", fim: "2027-04-30", justificativa: "Viagem de casamento combinada com o gestor" },
    });
    assert.equal(com.status, 200, com.texto);
    assert.equal((com.env.dados as PedidoJson).excedeSaldo, true);
  });

  test("periodo invertido, data falsa, periodo > 366 dias, tipo inexistente e so fim de semana = 422", async () => {
    const ana = await entrarComo("ana");
    const invalidos: Record<string, unknown>[] = [
      { tipoId: "outro", inicio: "2026-12-10", fim: "2026-12-01" },
      { tipoId: "outro", inicio: "2026-02-31", fim: "2026-03-01" },
      { tipoId: "outro", inicio: "2026-01-01", fim: "2027-12-31" },
      { tipoId: "inexistente", inicio: "2026-12-10", fim: "2026-12-11" },
      { tipoId: "outro", inicio: "2026-12-12", fim: "2026-12-13" },
      { tipoId: "outro", inicio: "10/12/2026", fim: "11/12/2026" },
    ];
    for (const corpo of invalidos) {
      const r = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: ana, corpo });
      assert.equal(r.status, 422, JSON.stringify(corpo));
    }
    assert.equal((await meusPedidos(ana)).length, 3);
  });

  test("tipo que so o admin lanca: colaborador 403; admin pode", async () => {
    const corpo = { tipoId: "sem-permissao", inicio: "2026-12-10", fim: "2026-12-10" };
    const a = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: await entrarComo("ana"), corpo });
    assert.equal(a.status, 403);
    const lista = (await chamar(rTipos.GET, "GET", "/tipos", { cookie: await entrarComo("ana") })).env.dados as { id: string }[];
    assert.ok(!lista.some((t) => t.id === "sem-permissao"));
    const b = await chamar(rPedidos.POST, "POST", "/pedidos", { cookie: await entrarComo("marina"), corpo });
    assert.equal(b.status, 200, b.texto);
  });

  test("aprovar: exige versao certa (409 se velha), vira aprovada/sincronizada e notifica a dona; decidir de novo = 404", async () => {
    const ana = await entrarComo("ana");
    const carlos = await entrarComo("carlos");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    const id = String(alvo.id);

    const velha = await chamar(rDecisao.POST, "POST", `/pedidos/${id}/decisao`, { cookie: carlos, corpo: { decisao: "aprovar", versao: alvo.versao + 7 } }, id);
    assert.equal(velha.status, 409);
    assert.equal((await pedidoDe(ana, (p) => p.id === alvo.id)).status, "pendente");

    const semMotivo = await chamar(rDecisao.POST, "POST", `/pedidos/${id}/decisao`, { cookie: carlos, corpo: { decisao: "recusar", versao: alvo.versao } }, id);
    assert.equal(semMotivo.status, 422);
    const sugestaoNaAprovacao = await chamar(rDecisao.POST, "POST", `/pedidos/${id}/decisao`, { cookie: carlos, corpo: { decisao: "aprovar", versao: alvo.versao, sugestao: { inicio: "2026-12-01", fim: "2026-12-02" } } }, id);
    assert.equal(sugestaoNaAprovacao.status, 422);

    const ok = await chamar(rDecisao.POST, "POST", `/pedidos/${id}/decisao`, { cookie: carlos, corpo: { decisao: "aprovar", versao: alvo.versao } }, id);
    assert.equal(ok.status, 200, ok.texto);
    const aprovado = ok.env.dados as PedidoJson & { sincronizacao: string };
    assert.equal(aprovado.status, "aprovada");
    assert.equal(aprovado.sincronizacao, "ok");

    const denovo = await chamar(rDecisao.POST, "POST", `/pedidos/${id}/decisao`, { cookie: carlos, corpo: { decisao: "aprovar", versao: aprovado.versao } }, id);
    assert.equal(denovo.status, 404);

    const notif = (await chamar(rNotificacoes.GET, "GET", "/notificacoes", { cookie: ana })).env.dados as { etapa: string }[];
    assert.ok(notif.some((n) => n.etapa === "confirmado"));
  });

  test("recusar com sugestao devolve a sugestao; para-aprovar so lista o que a sessao pode decidir", async () => {
    const ana = await entrarComo("ana");
    const carlos = await entrarComo("carlos");
    const fila = (await chamar(rParaAprovar.GET, "GET", "/pedidos/para-aprovar", { cookie: carlos })).env.dados as PedidoJson[];
    assert.deepEqual(fila.map((p) => p.pessoa.id).sort(), ["ana", "camila"]);
    assert.ok(fila.every((p) => p.permitido.decidir));
    assert.equal((await chamar(rParaAprovar.GET, "GET", "/pedidos/para-aprovar", { cookie: ana })).env.dados instanceof Array, true);
    assert.deepEqual((await chamar(rParaAprovar.GET, "GET", "/pedidos/para-aprovar", { cookie: ana })).env.dados, []);

    const alvo = fila.find((p) => p.pessoa.id === "ana") as PedidoJson;
    const r = await chamar(
      rDecisao.POST,
      "POST",
      `/pedidos/${alvo.id}/decisao`,
      { cookie: carlos, corpo: { decisao: "recusar", versao: alvo.versao, motivoDecisao: "Entrega do projeto nessas semanas", sugestao: { inicio: "2027-01-11", fim: "2027-01-22" } } },
      String(alvo.id),
    );
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual((r.env.dados as { sugestao: unknown }).sugestao, { inicio: "2027-01-11", fim: "2027-01-22" });
  });

  test("impacto mostra sem/com o pedido (cena do pitch: 4 de 7, minimo 5) e esconde o grafico do colaborador", async () => {
    const ana = await entrarComo("ana");
    const carlos = await entrarComo("carlos");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    const id = String(alvo.id);
    const r = await chamar(rImpacto.GET, "GET", `/pedidos/${id}/impacto`, { cookie: carlos }, id);
    assert.equal(r.status, 200, r.texto);
    const d = r.env.dados as { semanas: { semanaInicio: string; semPedido: number; comPedido: number }[] };
    const semana = d.semanas.find((s) => s.semanaInicio === "2026-11-16");
    assert.ok(semana);
    assert.equal(semana.semPedido, 5);
    assert.equal(semana.comPedido, 4);
    // A dona do pedido (colaborador) nao recebe o grafico da equipe.
    assert.equal((await chamar(rImpacto.GET, "GET", `/pedidos/${id}/impacto`, { cookie: ana }, id)).status, 404);
  });

  test("cancelar: a dona so antes do inicio; devolve saldo; depois do cancelamento nao cancela de novo (404)", async () => {
    const ana = await entrarComo("ana");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    assert.equal(alvo.permitido.cancelar, true);
    const id = String(alvo.id);
    const antes = (await chamar(rSaldos.GET, "GET", "/saldos", { cookie: ana })).env.dados as { carteira: string; disponivel: number }[];
    const r = await chamar(rCancelar.POST, "POST", `/pedidos/${id}/cancelar`, { cookie: ana }, id);
    assert.equal(r.status, 200, r.texto);
    assert.equal((r.env.dados as PedidoJson).status, "cancelada");
    const depois = (await chamar(rSaldos.GET, "GET", "/saldos", { cookie: ana })).env.dados as { carteira: string; disponivel: number }[];
    assert.equal(
      (depois.find((s) => s.carteira === "ferias")?.disponivel ?? 0) - (antes.find((s) => s.carteira === "ferias")?.disponivel ?? 0),
      alvo.diasUteis,
    );
    const denovo = await chamar(rCancelar.POST, "POST", `/pedidos/${id}/cancelar`, { cookie: ana }, id);
    assert.equal(denovo.status, 404);
    // Pedido aprovado e passado da Ana nao pode mais ser cancelado por ela.
    const passado = await pedidoDe(ana, (p) => p.status === "aprovada");
    const r2 = await chamar(rCancelar.POST, "POST", `/pedidos/${passado.id}/cancelar`, { cookie: ana }, String(passado.id));
    assert.equal(r2.status, 404);
  });

  test("lembrar gestor: so admin; no maximo 1 notificacao por dia e pedido", async () => {
    const ana = await entrarComo("ana");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    const id = String(alvo.id);
    const carlos = await entrarComo("carlos");
    // Rota [id]: negado = 404, ate para quem enxerga o pedido (gestor da equipe).
    assert.equal((await chamar(rLembrar.POST, "POST", `/pedidos/${id}/lembrar`, { cookie: carlos }, id)).status, 404);
    const marina = await entrarComo("marina");
    const contar = async () => ((await chamar(rNotificacoes.GET, "GET", "/notificacoes", { cookie: carlos })).env.dados as { etapa: string }[]).filter((n) => n.etapa.startsWith("lembrete:")).length;
    assert.equal(await contar(), 0);
    for (let i = 0; i < 3; i++) assert.equal((await chamar(rLembrar.POST, "POST", `/pedidos/${id}/lembrar`, { cookie: marina }, id)).status, 200);
    assert.equal(await contar(), 1);
  });

  test("reprocessar sincronizacao (admin) conserta a falha semeada", async () => {
    const marina = await entrarComo("marina");
    const log = (await chamar(rLog.GET, "GET", "/sincronizacao", { cookie: marina })).env.dados as { estado: string }[];
    assert.ok(log.some((l) => l.estado === "falha_manual"));
    const r = await chamar(rReprocessar.POST, "POST", "/sincronizacao/reprocessar", { cookie: marina });
    assert.equal(r.status, 200, r.texto);
    const depois = (await chamar(rLog.GET, "GET", "/sincronizacao", { cookie: marina })).env.dados as { estado: string; erro?: string }[];
    assert.ok(depois.some((l) => l.estado === "ok"), "job reprocessado fica concluido");
    const diego = await pedidoDe(await entrarComo("diego"), (p) => p.status === "aprovada");
    assert.equal((diego as PedidoJson & { sincronizacao: string }).sincronizacao, "ok");
  });

  test("etapas: edicao valida do admin vale para a proxima notificacao", async () => {
    const marina = await entrarComo("marina");
    const e = await chamar(rEtapas.PUT, "PUT", "/etapas", {
      cookie: marina,
      corpo: { chave: "confirmado", rotulo: "Tudo certo", mensagem: "Boa, {nome}! {tipoPublico} confirmado ({periodo})." },
    });
    assert.equal(e.status, 200, e.texto);
    const ana = await entrarComo("ana");
    const alvo = await pedidoDe(ana, (p) => p.status === "pendente");
    await chamar(rDecisao.POST, "POST", `/pedidos/${alvo.id}/decisao`, { cookie: await entrarComo("carlos"), corpo: { decisao: "aprovar", versao: alvo.versao } }, String(alvo.id));
    const notif = (await chamar(rNotificacoes.GET, "GET", "/notificacoes", { cookie: ana })).env.dados as { texto: string }[];
    assert.ok(notif.some((n) => n.texto.startsWith("Boa, Ana Ribeiro! Férias anuais confirmado (16/11 a 27/11).")));
  });
});
