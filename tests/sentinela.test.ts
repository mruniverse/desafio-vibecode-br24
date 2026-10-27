// Integração isolada: dados fictícios, SQLite scratch e Bitrix em memória.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { PortaBitrix } from "../src/lib/ausencias/portas.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-sentinela-"));
process.env.DATABASE_PATH = path.join(dir, "scratch.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.MODO_DEMO = "1";
process.env.BITRIX_ESCRITA = "0";
const SENTINELA = "MOTIVO_PRIVADO_FICTICIO_9d81d6e3";
const { getDb } = await import("../src/lib/db/index.ts");
const { semearDemo, PORTAL_DEMO } = await import("../src/lib/ausencias/seed.ts");
const { criarServicosAusencias } = await import("../src/lib/ausencias/servicos-impl.ts");
const { FakeBitrix } = await import("../src/lib/bitrix/ausencias/fake.ts");
const { rota } = await import("../src/lib/api.ts");
const { logger } = await import("../src/lib/logger.ts");

function procurarBanco(): string[] {
  const db = getDb();
  const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  assert.ok(tabelas.some(t => t.name === "pedido"));
  const achados: string[] = [];
  for (const { name } of tabelas) {
    // Identificadores de sqlite_master precisam ser escapados, inclusive tabelas futuras.
    const quoted = `"${name.replaceAll('"', '""')}"`;
    for (const linha of db.prepare(`SELECT * FROM ${quoted}`).all() as Record<string, unknown>[]) {
      for (const [coluna, valor] of Object.entries(linha)) {
        if ((typeof valor === "string" && valor.includes(SENTINELA)) ||
            (Buffer.isBuffer(valor) && valor.includes(Buffer.from(SENTINELA)))) achados.push(`${name}.${coluna}`);
      }
    }
  }
  return achados;
}

after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("motivo privado cifrado não vaza em SQLite, chamadas Bitrix, respostas não autorizadas ou logs", async () => {
  semearDemo({ hoje: "2026-10-26" });
  // Seed não associa usuários reais do Bitrix; vinculação exclusivamente fictícia.
  const vincular = getDb().prepare("UPDATE pessoa SET bitrix_user_id = ? WHERE portal_member_id = ? AND id = ?");
  vincular.run(1001, PORTAL_DEMO, "ana");
  vincular.run(1002, PORTAL_DEMO, "carlos");
  const fake = new FakeBitrix();
  const chamadasBrutas: unknown[] = [];
  // Inspeciona argumentos ANTES de FakeBitrix descartar campos extras.
  const porta = new Proxy(fake, {
    get(alvo, prop) {
      const valor = Reflect.get(alvo, prop, alvo);
      if (typeof valor !== "function") return valor;
      return (...args: unknown[]) => {
        chamadasBrutas.push({ operacao: String(prop), args: structuredClone(args) });
        return Reflect.apply(valor, alvo, args);
      };
    },
  }) as PortaBitrix;
  const sv = criarServicosAusencias({ portalMemberId: PORTAL_DEMO, porta,
    relogio: { hoje: () => "2026-10-26", agora: () => "2026-10-26T12:00:00.000Z" } });
  const dono = { pessoaId: "ana", papel: "colaborador" } as const;
  const gestor = { pessoaId: "carlos", papel: "gestor" } as const;
  const admin = { pessoaId: "marina", papel: "admin" } as const;
  const logs: string[] = [];
  const originais = [console.log, console.warn, console.error] as const;
  console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    await sv.aquecerCalendario();
    const criado = await sv.solicitar(dono, { tipoId: "doenca", inicio: "2027-03-08", fim: "2027-03-09", motivoPrivado: SENTINELA });
    assert.equal(sv.pedido(dono, criado.id).motivoPrivado, SENTINELA, "controle positivo: motivo foi persistido e decifrado para o dono");
    assert.equal(sv.pedido(admin, criado.id).motivoPrivado, SENTINELA);
    const aprovado = await sv.decidir(gestor, criado.id, { decisao: "aprovar", versao: criado.versao });
    assert.equal(aprovado.status, "aprovada");
    assert.equal(aprovado.sincronizacao, "ok", JSON.stringify(getDb().prepare("SELECT * FROM sync_job").all()));
    assert.ok(chamadasBrutas.some(c => (c as { operacao: string }).operacao === "criarEvento"));
    assert.ok(fake.eventos().length > 0);
    const resposta = await rota("teste.sentinela", async () => ({ pedido: sv.pedido(gestor, criado.id), lista: sv.paraAprovar(gestor), notificacoes: sv.notificacoes(gestor), calendario: sv.calendario(gestor, "tec", "2027-03-01", "2027-03-31") }));
    assert.equal(resposta.status, 200);
    assert.ok(!(await resposta.text()).includes(SENTINELA), "resposta JSON ao gestor");
    assert.ok(!JSON.stringify(chamadasBrutas).includes(SENTINELA), "argumentos brutos da porta");
    assert.ok(!fake.serializar().includes(SENTINELA), "eventos e notificações do fake");
    // Garante que ambos os destinos do logger são realmente exercitados.
    logger.info({ evento: "teste.sentinela", detalhe: { motivoPrivado: SENTINELA, contexto: "controle" } });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(fake.notificacoes().length > 0, "notificações efetivamente enviadas ao fake");
    assert.ok(!JSON.stringify(chamadasBrutas).includes(SENTINELA), "argumentos tardios da porta");
    assert.ok(!fake.serializar().includes(SENTINELA), "notificações concluídas no fake");
    assert.ok(logs.some(l => l.includes("teste.sentinela")), "stdout capturado");
    assert.ok(!logs.join("\n").includes(SENTINELA), "logs de console");
    assert.ok(getDb().prepare("SELECT 1 FROM operation_log WHERE event = ?").get("teste.sentinela"), "log SQLite persistido");
    assert.deepEqual(procurarBanco(), [], "varredura de todas as tabelas e colunas");
    // Controle de mutação seguro em tabela nova: prova descoberta dinâmica e detecção.
    getDb().exec('CREATE TABLE "controle_sentinela" (valor TEXT)');
    getDb().prepare('INSERT INTO "controle_sentinela" VALUES (?)').run(SENTINELA);
    assert.ok(procurarBanco().includes("controle_sentinela.valor"));
    getDb().exec('DROP TABLE "controle_sentinela"');
    assert.deepEqual(procurarBanco(), []);
  } finally {
    [console.log, console.warn, console.error] = originais;
  }
});
