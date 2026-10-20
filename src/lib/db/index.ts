/**
 * Acesso ao SQLite (better-sqlite3), com migracoes aplicadas na primeira
 * conexao do processo.
 *
 * Requisito do desafio: dados na pasta /data. O caminho vem de DATABASE_PATH
 * e o diretorio e criado se nao existir.
 *
 * Multi-cliente: NADA aqui tem id fixo de portal, usuario, campo ou funil.
 * Todo registro e chaveado por `portal_member_id` (o member_id que o Bitrix24
 * envia no handshake de instalacao).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getEnv } from "@/lib/env";

type Conexao = Database.Database;

// Em dev o Next recarrega modulos a cada edicao; guardar no global evita
// abrir dezenas de conexoes e o erro "database is locked".
const globalParaDb = globalThis as unknown as { __br24db?: Conexao };

const MIGRACOES: { nome: string; sql: string }[] = [
  {
    nome: "001_inicial",
    sql: `
      -- Portais (contas Bitrix24) conectados ao app.
      -- auth_mode decide como autenticamos as chamadas REST:
      --   OAUTH   = aplicativo local instalado no portal (tokens + refresh)
      --   WEBHOOK = webhook de entrada (URL com codigo, sem expiracao)
      CREATE TABLE IF NOT EXISTS portal (
        member_id         TEXT PRIMARY KEY,
        domain            TEXT NOT NULL,
        client_endpoint   TEXT NOT NULL,
        auth_mode         TEXT NOT NULL DEFAULT 'OAUTH'
                            CHECK (auth_mode IN ('OAUTH', 'WEBHOOK')),
        access_token_enc  TEXT,
        refresh_token_enc TEXT,
        expires_at        INTEGER,
        scope             TEXT,
        -- Preenchido somente no modo WEBHOOK: a URL completa do webhook de
        -- entrada, cifrada (ela e, na pratica, um segredo de acesso total).
        webhook_url_enc   TEXT,
        installed_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        setup_completed   INTEGER NOT NULL DEFAULT 0
      );

      -- Credenciais do aplicativo local, por portal, informadas no wizard.
      -- client_secret guardado cifrado (AES-256-GCM).
      CREATE TABLE IF NOT EXISTS portal_credential (
        member_id         TEXT PRIMARY KEY REFERENCES portal(member_id) ON DELETE CASCADE,
        client_id         TEXT NOT NULL,
        client_secret_enc TEXT NOT NULL,
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Parametros livres do app por portal (preenchidos no wizard).
      CREATE TABLE IF NOT EXISTS portal_setting (
        member_id  TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        key        TEXT NOT NULL,
        value      TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (member_id, key)
      );

      -- Cache local de respostas da API REST, com TTL.
      -- Evita bater na API do Bitrix a cada tela (requisito do desafio).
      CREATE TABLE IF NOT EXISTS api_cache (
        member_id  TEXT NOT NULL,
        cache_key  TEXT NOT NULL,
        payload    TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (member_id, cache_key)
      );
      CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache (expires_at);

      -- Log das operacoes relevantes, exibido na tela de diagnostico.
      CREATE TABLE IF NOT EXISTS operation_log (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        level            TEXT NOT NULL,
        event            TEXT NOT NULL,
        portal_member_id TEXT,
        detail           TEXT,
        error            TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_operation_log_created ON operation_log (created_at DESC);
    `,
  },
];

function aplicarMigracoes(db: Conexao) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  const jaAplicada = db.prepare(
    "SELECT 1 FROM schema_migration WHERE name = ?",
  );
  const registrar = db.prepare(
    "INSERT INTO schema_migration (name) VALUES (?)",
  );

  for (const migracao of MIGRACOES) {
    if (jaAplicada.get(migracao.nome)) continue;
    db.transaction(() => {
      db.exec(migracao.sql);
      registrar.run(migracao.nome);
    })();
  }
}

export function getDb(): Conexao {
  if (globalParaDb.__br24db) return globalParaDb.__br24db;

  const caminho = path.resolve(process.cwd(), getEnv().DATABASE_PATH);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });

  const db = new Database(caminho);
  db.pragma("journal_mode = WAL"); // leitura concorrente sem travar escrita
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  aplicarMigracoes(db);

  globalParaDb.__br24db = db;
  return db;
}
