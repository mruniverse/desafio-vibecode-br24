import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { MIGRACOES } from "../src/lib/db/migracoes/index.ts";

const raiz = path.resolve(import.meta.dirname, "..");
const script = `
import fs from 'node:fs';
import Database from 'better-sqlite3';
const original = Database.prototype.prepare;
Database.prototype.prepare = function(sql, ...args) {
  const statement = original.call(this, sql, ...args);
  if (!sql.startsWith('SELECT 1 FROM schema_migration')) return statement;
  const db = this;
  return new Proxy(statement, { get(target, prop) {
    if (prop !== 'get') { const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; }
    return (...params) => {
      const result = target.get(...params);
      // Só sincroniza leituras fora da transação: sob lock o outro processo
      // não pode chegar aqui até a primeira transação terminar.
      if (process.env.SINCRONIZAR === '1' && !db.inTransaction && !result && params[0] === (process.env.MIGRACAO_ALVO || '001_inicial')) {
        fs.writeFileSync(process.env.BARREIRA + '/' + process.env.NUMERO, 'pronto');
        const limite = Date.now() + 10000;
        while (!fs.existsSync(process.env.BARREIRA + '/' + (process.env.NUMERO === '0' ? '1' : '0'))) {
          if (Date.now() > limite) throw new Error('barreira expirou');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
      }
      return result;
    };
  }});
};
const { getDb } = await import(process.env.DB_MODULE);
getDb().close();
`;

function iniciar(db: string, dir: string, numero: number, sincronizar = false, alvo = "001_inicial"): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", pathToFileURL(path.join(raiz, "tests/registrar-alias.mjs")).href, "--input-type=module", "-e", script], {
      cwd: raiz, timeout: 20000,
      env: { ...process.env, DATABASE_PATH: db, APP_ENCRYPTION_KEY: "chave-de-teste", DB_MODULE: pathToFileURL(path.join(raiz, "src/lib/db/index.ts")).href, BARREIRA: dir, NUMERO: String(numero), SINCRONIZAR: sincronizar ? "1" : "0", MIGRACAO_ALVO: alvo },
    }, (erro, _stdout, stderr) => erro ? reject(new Error(`${erro.message}\n${stderr}`)) : resolve());
  });
}

test("processos concorrentes aplicam cada migração apenas uma vez", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migracoes-concorrencia-"));
  const arquivo = path.join(dir, "teste.db");
  try {
    const db = new Database(arquivo);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE schema_migration (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    db.close();
    const resultados = await Promise.allSettled([iniciar(arquivo, dir, 0, true), iniciar(arquivo, dir, 1, true)]);
    assert.deepEqual(resultados.filter((r) => r.status === "rejected"), []);
    const verificar = new Database(arquivo, { readonly: true });
    try {
      const nomes = verificar.prepare("SELECT name FROM schema_migration ORDER BY name").all();
      assert.deepEqual(nomes, MIGRACOES.filter((m) => m.sql.trim()).map((m) => ({ name: m.nome })).sort((a, b) => a.name.localeCompare(b.name)));
      assert.equal(verificar.pragma("integrity_check", { simple: true }), "ok");
    } finally { verificar.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("erros reais de schema não são ignorados nem registram migração", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migracoes-schema-"));
  const arquivo = path.join(dir, "teste.db");
  try {
    const db = new Database(arquivo);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE api_cache (outra_coluna TEXT)");
    db.close();
    await assert.rejects(iniciar(arquivo, dir, 0), /no such column: expires_at/);
    const verificar = new Database(arquivo, { readonly: true });
    try { assert.deepEqual(verificar.prepare("SELECT count(*) AS n FROM schema_migration").get(), { n: 0 }); }
    finally { verificar.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("upgrade concorrente de banco que JA esta na 003 (com dados) aplica a 004 uma vez e preserva os dados", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migracoes-upgrade-"));
  const arquivo = path.join(dir, "teste.db");
  try {
    const db = new Database(arquivo);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec("CREATE TABLE schema_migration (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    // Estado de producao antes da 004: migracoes 001-003 aplicadas, com dados.
    for (const m of MIGRACOES.filter((x) => x.nome < "004")) {
      if (!m.sql.trim()) continue;
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migration (name) VALUES (?)").run(m.nome);
    }
    db.prepare("INSERT INTO portal (member_id, domain, client_endpoint, auth_mode) VALUES ('demo:upgrade', 'demo.invalid', 'https://demo.invalid/rest', 'WEBHOOK')").run();
    db.close();

    // Barreira na leitura da 004: os dois processos chegam juntos a decidir se aplicam.
    const resultados = await Promise.allSettled([
      iniciar(arquivo, dir, 0, true, "004_sync_geracao"),
      iniciar(arquivo, dir, 1, true, "004_sync_geracao"),
    ]);
    assert.deepEqual(resultados.filter((r) => r.status === "rejected"), []);

    const verificar = new Database(arquivo, { readonly: true });
    try {
      const aplicadas = verificar.prepare("SELECT name FROM schema_migration WHERE name = '004_sync_geracao'").all();
      assert.equal(aplicadas.length, 1, "a 004 foi registrada uma unica vez");
      const colunas = verificar.prepare("PRAGMA table_info(sync_job)").all() as { name: string }[];
      assert.equal(colunas.filter((c) => c.name === "geracao").length, 1, "coluna geracao criada uma vez");
      assert.deepEqual(verificar.prepare("SELECT member_id FROM portal").all(), [{ member_id: "demo:upgrade" }], "dados preservados");
      assert.equal(verificar.pragma("integrity_check", { simple: true }), "ok");
    } finally { verificar.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
