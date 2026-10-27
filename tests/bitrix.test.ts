/**
 * Testes da integracao Bitrix de ausencias (BR24-005, C3): fake rotulado,
 * adaptador real (com REST injetado, sem rede) e executor de sincronizacao.
 *
 *   npm run test:bitrix
 *
 * Todos os dados sao ficticios. A sentinela `SENTINELA_SECRETA` representa
 * justificativa/motivo e nunca pode aparecer em nada que cruze a porta.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { PortaBitrix } from "../src/lib/ausencias/portas.ts";
import { NOME_EVENTO_BITRIX } from "../src/lib/ausencias/tipos.ts";
import {
  BitrixReal,
  ErroPortaBitrix,
  FakeBitrix,
  ROTULO_BITRIX_SIMULADO,
  converterCalendario,
  escaparBBCode,
  escolherPorta,
  executarSincronizacao,
  montarMarcador,
} from "../src/lib/bitrix/ausencias/index.ts";
import type {
  ChamadaRest,
  JobSincronizacao,
} from "../src/lib/bitrix/ausencias/index.ts";

const SENTINELA = "SENTINELA_SECRETA";
const URL_WEBHOOK = "https://portal-ficticio.example.com/rest/7/CODIGOFICTICIO123/";

function job(sobrescrever: Partial<JobSincronizacao> = {}): JobSincronizacao {
  return {
    operacao: "adicionar",
    pedidoId: 12,
    ownerId: 5,
    inicio: "2026-11-09",
    fim: "2026-11-13",
    tentativas: 0,
    ...sobrescrever,
  };
}

/* ------------------------------------------------------------------ fake */

test("fake e rotulado como simulado", () => {
  const fake = new FakeBitrix();
  assert.equal(ROTULO_BITRIX_SIMULADO, "simulado");
  assert.equal(fake.rotulo, ROTULO_BITRIX_SIMULADO);
  assert.equal(fake.modo, "simulado");
});

test("fake nao e idempotente no add (como o Bitrix real): duas criacoes = dois eventos", async () => {
  const fake = new FakeBitrix();
  const evento = {
    marcador: montarMarcador(1),
    ownerId: 5,
    inicio: "2026-11-09",
    fim: "2026-11-09",
    nome: NOME_EVENTO_BITRIX,
  } as const;
  await fake.criarEvento(evento);
  await fake.criarEvento(evento);
  assert.equal(fake.eventos().length, 2);
});

test("fake: evento criado tem name Ausente, description so com o marcador, absent e dia inteiro", async () => {
  const fake = new FakeBitrix();
  const r = await executarSincronizacao(fake, job());
  assert.equal(r.sincronizacao, "ok");
  const [evento] = fake.eventos();
  assert.equal(evento.nome, "Ausente");
  assert.equal(evento.description, "[BR24:12]");
  assert.equal(evento.accessibility, "absent");
  assert.equal(evento.skipTime, "Y");
});

/* -------------------------------------------------------------- executor */

test("timeout pos-criacao + retry: acha o marcador e NAO duplica", async () => {
  const fake = new FakeBitrix({ falhas: { timeoutPosCriacao: 1 } });
  const r = await executarSincronizacao(fake, job());
  assert.equal(r.sincronizacao, "ok");
  assert.equal(r.tentativas, 2);
  const eventos = fake.eventos();
  assert.equal(eventos.length, 1);
  assert.equal(r.bitrixEventId, eventos[0].id);
  assert.equal(r.erro, undefined);
  assert.equal(fake.chamadas().filter((c) => c.operacao === "criarEvento").length, 1);
});

test("reprocessar um add incerto (tentativas>0) busca o marcador antes de criar", async () => {
  const fake = new FakeBitrix({ falhas: { timeoutPosCriacao: 1 } });
  const primeira = await executarSincronizacao(fake, job(), { maxTentativas: 1 });
  assert.equal(primeira.sincronizacao, "falha_manual");
  assert.equal(fake.eventos().length, 1); // criou apesar do timeout
  const segunda = await executarSincronizacao(fake, job({ tentativas: 0 }));
  assert.equal(segunda.sincronizacao, "ok");
  assert.equal(fake.eventos().length, 1);
  assert.equal(segunda.bitrixEventId, fake.eventos()[0].id);
});

test("erro transitorio e repetido e termina ok", async () => {
  const fake = new FakeBitrix({ falhas: { transitorioBuscar: 1, transitorioCriar: 1 } });
  const r = await executarSincronizacao(fake, job());
  assert.equal(r.sincronizacao, "ok");
  assert.equal(r.tentativas, 3);
  assert.equal(fake.eventos().length, 1);
});

test("3 falhas seguidas => falha_manual, sem URL de webhook na mensagem", async () => {
  const porta: PortaBitrix = {
    ...semOperacao(),
    buscarEvento: async () => {
      throw new Error(`fetch failed para ${URL_WEBHOOK}calendar.event.get.json auth=TOKENFICTICIO`);
    },
  };
  const r = await executarSincronizacao(porta, job());
  assert.equal(r.sincronizacao, "falha_manual");
  assert.equal(r.tentativas, 3);
  assert.ok(r.erro && r.erro.length > 0);
  assert.ok(!r.erro.includes("https://"), r.erro);
  assert.ok(!r.erro.includes("CODIGOFICTICIO123"), r.erro);
  assert.ok(!r.erro.includes("TOKENFICTICIO"), r.erro);
});

test("orcamento de tentativas e acumulado: 2 gastas => 1 tentativa; 3 gastas => nenhuma chamada", async () => {
  const fake = new FakeBitrix({ falhas: { transitorioBuscar: 5 } });
  const a = await executarSincronizacao(fake, job({ tentativas: 2 }));
  assert.equal(a.sincronizacao, "falha_manual");
  assert.equal(a.tentativas, 3);
  assert.equal(fake.chamadas().length, 1);

  const antes = fake.chamadas().length;
  const b = await executarSincronizacao(fake, job({ tentativas: 3 }));
  assert.equal(b.sincronizacao, "falha_manual");
  assert.equal(fake.chamadas().length, antes);
});

test("dois executores concorrentes no mesmo pedido nao duplicam o evento", async () => {
  const fake = new FakeBitrix();
  const [a, b] = await Promise.all([
    executarSincronizacao(fake, job()),
    executarSincronizacao(fake, job()),
  ]);
  assert.equal(a.sincronizacao, "ok");
  assert.equal(b.sincronizacao, "ok");
  assert.equal(fake.eventos().length, 1);
  assert.equal(a.bitrixEventId, b.bitrixEventId);
});

test("concorrencia: 5 executores no mesmo pedido, mesmo com timeout pos-criacao, 1 evento", async () => {
  const fake = new FakeBitrix({ falhas: { timeoutPosCriacao: 1 } });
  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => executarSincronizacao(fake, job())),
  );
  assert.ok(resultados.every((r) => r.sincronizacao === "ok"));
  assert.equal(fake.eventos().length, 1);
});

test("pedidos diferentes em paralelo geram eventos diferentes", async () => {
  const fake = new FakeBitrix();
  await Promise.all([
    executarSincronizacao(fake, job({ pedidoId: 1 })),
    executarSincronizacao(fake, job({ pedidoId: 2 })),
  ]);
  assert.deepEqual(
    fake.eventos().map((e) => e.marcador).sort(),
    ["[BR24:1]", "[BR24:2]"],
  );
});

test("remover evento existente apaga e devolve removido", async () => {
  const fake = new FakeBitrix();
  await executarSincronizacao(fake, job());
  const r = await executarSincronizacao(fake, job({ operacao: "remover" }));
  assert.equal(r.sincronizacao, "removido");
  assert.equal(fake.eventos().length, 0);
});

test("remover inexistente e sucesso (removido), sem chamar delete", async () => {
  const fake = new FakeBitrix();
  const r = await executarSincronizacao(fake, job({ operacao: "remover" }));
  assert.equal(r.sincronizacao, "removido");
  assert.equal(r.erro, undefined);
  assert.equal(fake.chamadas().filter((c) => c.operacao === "removerEvento").length, 0);
});

test("delete com NOT_FOUND (injetado) e sucesso", async () => {
  const fake = new FakeBitrix({ falhas: { notFoundNoDelete: 1 } });
  await executarSincronizacao(fake, job());
  const r = await executarSincronizacao(fake, job({ operacao: "remover" }));
  assert.equal(r.sincronizacao, "removido");
  assert.equal(r.tentativas, 1);
  assert.equal(fake.eventos().length, 0);
});

test("remover com id conhecido e marcador nao achado ainda tenta o id e tolera NOT_FOUND", async () => {
  const chamadas: string[] = [];
  const porta: PortaBitrix = {
    ...semOperacao(),
    buscarEvento: async () => null,
    removerEvento: async (id) => {
      chamadas.push(id);
      throw new ErroPortaBitrix("NOT_FOUND", "sumiu");
    },
  };
  const r = await executarSincronizacao(porta, job({ operacao: "remover", bitrixEventId: "77" }));
  assert.equal(r.sincronizacao, "removido");
  assert.deepEqual(chamadas, ["77"]);
});

test("remover com falha transitoria repete e esgota em falha_manual", async () => {
  const fake = new FakeBitrix({ falhas: { transitorioRemover: 3 } });
  await executarSincronizacao(fake, job());
  const r = await executarSincronizacao(fake, job({ operacao: "remover" }));
  assert.equal(r.sincronizacao, "falha_manual");
  assert.equal(r.tentativas, 3);
  assert.equal(fake.eventos().length, 1);
});

test("erro permanente nao e repetido: falha_manual na 1a tentativa", async () => {
  let chamadas = 0;
  const porta: PortaBitrix = {
    ...semOperacao(),
    buscarEvento: async () => {
      chamadas += 1;
      throw new ErroPortaBitrix("SEM_PERMISSAO", "sem permissao no calendario");
    },
  };
  const r = await executarSincronizacao(porta, job());
  assert.equal(r.sincronizacao, "falha_manual");
  assert.equal(r.tentativas, 1);
  assert.equal(chamadas, 1);
});

test("job invalido vira falha_manual sem tocar a porta", async () => {
  const fake = new FakeBitrix();
  for (const ruim of [
    job({ pedidoId: 0 }),
    job({ ownerId: -1 }),
    job({ inicio: "2026-02-31" }),
    job({ inicio: "2026-11-13", fim: "2026-11-09" }),
    job({ tentativas: -1 }),
    { ...job(), operacao: "apagar" } as unknown as JobSincronizacao,
  ]) {
    const r = await executarSincronizacao(fake, ruim);
    assert.equal(r.sincronizacao, "falha_manual");
  }
  assert.equal(fake.chamadas().length, 0);
});

/* ------------------------------------------------------------- sentinela */

test("payload do fake nunca contem justificativa/motivo (sentinela)", async () => {
  const fake = new FakeBitrix({ falhas: { timeoutPosCriacao: 1 } });
  // O objeto do job tenta contrabandear campos sensiveis.
  const contrabando = {
    ...job(),
    justificativa: SENTINELA,
    motivoPrivado: SENTINELA,
    motivoDecisao: SENTINELA,
    motivo: SENTINELA,
    descricao: SENTINELA,
  } as unknown as JobSincronizacao;
  await executarSincronizacao(fake, contrabando);
  await executarSincronizacao(fake, { ...contrabando, operacao: "remover" });
  await fake.notificar(5, "Seu pedido foi aprovado");
  const tudo = fake.serializar();
  assert.ok(tudo.length > 50);
  assert.ok(!tudo.includes(SENTINELA));
  assert.ok(!/justificativa|motivo/i.test(tudo));
  // E a porta tambem descarta campos extras entregues direto a ela:
  const direto = new FakeBitrix();
  await direto.criarEvento({
    marcador: "[BR24:9]",
    ownerId: 5,
    inicio: "2026-11-09",
    fim: "2026-11-09",
    nome: NOME_EVENTO_BITRIX,
    justificativa: SENTINELA,
  } as never);
  assert.ok(!direto.serializar().includes(SENTINELA));
});

test("adaptador real: parametros REST do add nao carregam a sentinela e usam so o marcador", async () => {
  const { chamar, chamadas } = restEspiao({ "calendar.event.add": 321, "calendar.event.getbyid": { SECTION_ID: "9" } });
  const real = new BitrixReal({ chamar, env: { BITRIX_ESCRITA: "1" } });
  const r = await real.criarEvento({
    marcador: "[BR24:12]",
    ownerId: 5,
    inicio: "2026-11-09",
    fim: "2026-11-13",
    nome: NOME_EVENTO_BITRIX,
    justificativa: SENTINELA,
  } as never);
  assert.deepEqual(r, { id: "321", secao: 9 });
  const add = chamadas.find((c) => c.metodo === "calendar.event.add");
  assert.ok(add);
  assert.deepEqual(add.parametros, {
    type: "user",
    ownerId: 5,
    from: "2026-11-09T00:00:00-03:00",
    to: "2026-11-13T23:59:59-03:00",
    skip_time: "Y",
    accessibility: "absent",
    name: "Ausente",
    description: "[BR24:12]",
    auto_detect_section: "Y",
  });
  assert.ok(!JSON.stringify(chamadas).includes(SENTINELA));
});

/* --------------------------------------------------------------- BBCode */

test("BBCode e escapado: nenhum colchete cru chega ao Bitrix", async () => {
  const hostil = "Aprovado [URL=https://evil.example/x]clique[/URL] [B]negrito[/B] [USER=1]x[/USER]";
  const escapado = escaparBBCode(hostil);
  assert.ok(!escapado.includes("["));
  assert.ok(!escapado.includes("]"));
  assert.ok(escapado.includes("URL=")); // o texto continua legivel
  assert.equal(escaparBBCode("sem tags"), "sem tags");
  assert.ok(escaparBBCode("a\u0000b\u0007c").indexOf("\u0000") === -1);

  const { chamar, chamadas } = restEspiao({ "im.notify.system.add": 1 });
  const real = new BitrixReal({ chamar, env: { BITRIX_ESCRITA: "1" } });
  await real.notificar(5, hostil);
  const envio = chamadas.find((c) => c.metodo === "im.notify.system.add");
  assert.ok(envio);
  assert.equal(envio.parametros.USER_ID, 5);
  const mensagem = String(envio.parametros.MESSAGE);
  assert.ok(!mensagem.includes("[") && !mensagem.includes("]"));
  assert.equal(envio.parametros.TAG, undefined);

  const fake = new FakeBitrix();
  await fake.notificar(5, hostil);
  assert.ok(!fake.notificacoes()[0].mensagem.includes("["));
});

/* ------------------------------------------------- escrita no portal real */

test("escrita no portal real bloqueada sem BITRIX_ESCRITA=1 (nenhuma chamada de rede)", async () => {
  for (const env of [{}, { BITRIX_ESCRITA: "0" }, { BITRIX_ESCRITA: "true" }, { BITRIX_ESCRITA: "" }]) {
    const { chamar, chamadas } = restEspiao({});
    const real = new BitrixReal({ chamar, env });
    const evento = { marcador: "[BR24:12]", ownerId: 5, inicio: "2026-11-09", fim: "2026-11-09", nome: NOME_EVENTO_BITRIX } as const;
    await assert.rejects(real.criarEvento(evento), codigo("ESCRITA_BLOQUEADA"));
    await assert.rejects(real.removerEvento("10", 5), codigo("ESCRITA_BLOQUEADA"));
    await assert.rejects(real.notificar(5, "oi"), codigo("ESCRITA_BLOQUEADA"));
    assert.equal(chamadas.length, 0);
  }
});

test("mensagem de bloqueio e clara e executor devolve falha_manual sem repetir", async () => {
  const { chamar, chamadas } = restEspiao({});
  const real = new BitrixReal({ chamar, env: {} });
  const r = await executarSincronizacao(real, job());
  assert.equal(r.sincronizacao, "falha_manual");
  assert.equal(r.tentativas, 1);
  assert.match(r.erro ?? "", /BITRIX_ESCRITA=1/);
  assert.ok(!chamadas.some((c) => c.metodo === "calendar.event.add"));
});

test("portalDeTeste=false bloqueia mesmo com BITRIX_ESCRITA=1; leitura segue liberada", async () => {
  const { chamar, chamadas } = restEspiao({ "calendar.event.get": [] });
  const real = new BitrixReal({ chamar, env: { BITRIX_ESCRITA: "1" }, portalDeTeste: () => false });
  await assert.rejects(real.notificar(5, "oi"), codigo("ESCRITA_BLOQUEADA"));
  assert.equal(await real.buscarEvento("[BR24:12]", 5, "2026-11-09", "2026-11-13"), null);
  assert.equal(chamadas.length, 1);
});

test("escolherPorta: fake por padrao; real so com BITRIX_ESCRITA=1", () => {
  const fake = new FakeBitrix();
  assert.equal(escolherPorta({ env: {}, fake }), fake);
  assert.equal(escolherPorta({ env: { BITRIX_ESCRITA: "0" }, fake }), fake);
  assert.equal(escolherPorta({ env: {} }).modo, "simulado");
  const real = escolherPorta({ env: { BITRIX_ESCRITA: "1" }, fake });
  assert.equal(real.modo, "real");
  assert.ok(real instanceof BitrixReal);
});

/* ------------------------------------------------------ adaptador real */

test("real: buscarEvento acha pelo marcador exato e ignora outro pedido e deletados", async () => {
  const { chamar, chamadas } = restEspiao({
    "calendar.event.get": [
      { ID: "1", DESCRIPTION: "[BR24:120]" },
      { ID: "2", DESCRIPTION: "[BR24:12]", DELETED: "Y" },
      { ID: "3", DESCRIPTION: "reuniao" },
      { ID: 4, DESCRIPTION: "[BR24:12]" },
    ],
  });
  const real = new BitrixReal({ chamar, env: {} });
  assert.deepEqual(await real.buscarEvento("[BR24:12]", 5, "2026-11-09", "2026-11-13"), { id: "4" });
  assert.deepEqual(chamadas[0].parametros, { type: "user", ownerId: 5, from: "2026-11-09", to: "2026-11-13" });
  assert.equal(await real.buscarEvento("[BR24:1]", 5, "2026-11-09", "2026-11-13"), null);
});

test("real: removerEvento com NOT_FOUND e sucesso; credencial revogada de verdade continua erro", async () => {
  const notFound = Object.assign(new Error("Webhook rejeitado: NOT_FOUND"), {
    codigo: "CREDENCIAIS_INVALIDAS",
    mensagemUsuario: "As credenciais do aplicativo local nao foram aceitas pelo Bitrix24.",
  });
  // Leitura de confirmacao passa => o evento nao existe => sucesso.
  const ok = restEspiao({ "calendar.settings.get": {} }, { "calendar.event.delete": notFound });
  await new BitrixReal({ chamar: ok.chamar, env: { BITRIX_ESCRITA: "1" } }).removerEvento("10", 5);
  assert.deepEqual(ok.chamadas.map((c) => c.metodo), ["calendar.event.delete", "calendar.settings.get"]);

  // Leitura de confirmacao tambem falha => credencial ruim => erro.
  const revogado = Object.assign(new Error("Webhook rejeitado: INVALID_CREDENTIALS"), {
    codigo: "CREDENCIAIS_INVALIDAS",
    mensagemUsuario: "As credenciais do aplicativo local nao foram aceitas pelo Bitrix24.",
  });
  const ruim = restEspiao({}, { "calendar.event.delete": notFound, "calendar.settings.get": revogado });
  await assert.rejects(
    new BitrixReal({ chamar: ruim.chamar, env: { BITRIX_ESCRITA: "1" } }).removerEvento("10", 5),
    codigo("CREDENCIAIS_INVALIDAS"),
  );

  // Erro que nao e NOT_FOUND propaga sem confirmacao.
  const queda = restEspiao({}, { "calendar.event.delete": Object.assign(new Error("Timeout de 10000ms ao chamar portal-ficticio.example.com"), { codigo: "PORTAL_INDISPONIVEL", mensagemUsuario: "Nao conseguimos falar com o seu portal." }) });
  await assert.rejects(
    new BitrixReal({ chamar: queda.chamar, env: { BITRIX_ESCRITA: "1" } }).removerEvento("10", 5),
    (e: unknown) => e instanceof ErroPortaBitrix && e.codigo === "TRANSITORIO" && e.transitorio,
  );
  assert.deepEqual(queda.chamadas.map((c) => c.metodo), ["calendar.event.delete"]);
});

test("real: erro do cliente nao vaza URL de webhook na mensagem", async () => {
  const vazando = Object.assign(new Error(`falha em ${URL_WEBHOOK}`), {
    codigo: "RESPOSTA_INVALIDA",
    mensagemUsuario: "O Bitrix24 respondeu em um formato inesperado.",
  });
  const { chamar } = restEspiao({}, { "calendar.event.get": vazando });
  const real = new BitrixReal({ chamar, env: {} });
  await assert.rejects(real.buscarEvento("[BR24:12]", 5, "2026-11-09", "2026-11-13"), (e: unknown) => {
    assert.ok(e instanceof Error);
    assert.ok(!e.message.includes("https://"));
    assert.ok(!e.message.includes("CODIGOFICTICIO123"));
    return true;
  });
});

test("real: calendarioTrabalho converte year_holidays D.M em MM-DD, com cache", async () => {
  let agora = 1_000;
  const { chamar, chamadas } = restEspiao({
    "calendar.settings.get": {
      year_holidays: "1.01,2.01, 7.09 ,25.12,31.02,xx,29.2",
      week_holidays: ["SA", "SU"],
      year_workdays: "31.12",
      work_time_start: "9",
    },
  });
  const real = new BitrixReal({ chamar, env: {}, agoraMs: () => agora, anoReferencia: () => 2026, ttlCalendarioMs: 5_000 });
  const c = await real.calendarioTrabalho();
  assert.deepEqual(c.feriados, ["01-01", "01-02", "09-07", "12-25", "02-29"]);
  assert.deepEqual(c.diasNaoUteis, ["SA", "SU"]);
  assert.deepEqual(c.excecoesTrabalhadas, ["2025-12-31", "2026-12-31", "2027-12-31", "2028-12-31"]);
  await real.calendarioTrabalho();
  assert.equal(chamadas.length, 1); // cache
  agora += 6_000;
  await real.calendarioTrabalho();
  assert.equal(chamadas.length, 2); // expirou
});

test("converterCalendario: padrao SA,SU sem week_holidays; aceita D.M.AAAA; entrada vazia", () => {
  const c = converterCalendario({ year_holidays: "1.5.2027" }, 2026);
  assert.deepEqual(c, { diasNaoUteis: ["SA", "SU"], feriados: ["2027-05-01"], excecoesTrabalhadas: [] });
  assert.deepEqual(converterCalendario({}, 2026), { diasNaoUteis: ["SA", "SU"], feriados: [], excecoesTrabalhadas: [] });
  assert.deepEqual(converterCalendario({ week_holidays: [] }, 2026).diasNaoUteis, []);
});

test("real: entradas invalidas lancam ENTRADA_INVALIDA sem rede", async () => {
  const { chamar, chamadas } = restEspiao({});
  const real = new BitrixReal({ chamar, env: { BITRIX_ESCRITA: "1" } });
  await assert.rejects(real.buscarEvento("12", 5, "2026-11-09", "2026-11-13"), codigo("ENTRADA_INVALIDA"));
  await assert.rejects(real.buscarEvento("[BR24:12]", 0, "2026-11-09", "2026-11-13"), codigo("ENTRADA_INVALIDA"));
  await assert.rejects(real.buscarEvento("[BR24:12]", 5, "2026-02-31", "2026-03-01"), codigo("ENTRADA_INVALIDA"));
  await assert.rejects(
    real.criarEvento({ marcador: "[BR24:12]", ownerId: 5, inicio: "2026-11-09", fim: "2026-11-09", nome: "Ferias" as never }),
    codigo("ENTRADA_INVALIDA"),
  );
  assert.throws(() => new BitrixReal({ offset: "-0300" }), /offset/);
  assert.equal(chamadas.length, 0);
});

/* ----------------------------------------------------------- isolamento */

test("modulos de bitrix/ausencias nao importam db/logger/client estaticamente", () => {
  const dir = path.join(import.meta.dirname, "..", "src", "lib", "bitrix", "ausencias");
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(arquivos.length >= 6);
  for (const f of arquivos) {
    const fonte = fs.readFileSync(path.join(dir, f), "utf8");
    const estaticos = [...fonte.matchAll(/^import\s[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const origem of estaticos) {
      assert.ok(
        !/^@\/lib\/(db|logger|bitrix\/client)|^next\/|better-sqlite3/.test(origem),
        `${f} importa ${origem}`,
      );
    }
  }
});

/* --------------------------------------------------------------- helpers */

function codigo(esperado: string) {
  return (e: unknown) => e instanceof ErroPortaBitrix && e.codigo === esperado;
}

/** Porta que falha em tudo; testes sobrescrevem so o que importa. */
function semOperacao(): PortaBitrix {
  const nao = async (): Promise<never> => {
    throw new Error("nao esperado");
  };
  return {
    buscarEvento: nao,
    criarEvento: nao,
    removerEvento: nao,
    calendarioTrabalho: nao,
    notificar: nao,
  };
}

/** REST falso: respostas por metodo; `erros` faz o metodo lancar. */
function restEspiao(respostas: Record<string, unknown>, erros: Record<string, Error> = {}) {
  const chamadas: { metodo: string; parametros: Record<string, unknown> }[] = [];
  const chamar: ChamadaRest = async (metodo, parametros) => {
    chamadas.push({ metodo, parametros });
    if (erros[metodo]) throw erros[metodo];
    return { result: respostas[metodo] };
  };
  return { chamar, chamadas };
}
