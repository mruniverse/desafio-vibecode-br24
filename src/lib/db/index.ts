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
import { MIGRACOES } from "./migracoes";

type Conexao = Database.Database;

// Em dev o Next recarrega modulos a cada edicao; guardar no global evita
// abrir dezenas de conexoes e o erro "database is locked".
const globalParaDb = globalThis as unknown as { __br24db?: Conexao };


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
    if (!migracao.sql.trim()) continue; // reservada, ainda sem conteudo
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
