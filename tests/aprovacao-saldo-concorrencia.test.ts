import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aprovacao-saldo-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.MODO_DEMO = "1";
const raiz = path.resolve(import.meta.dirname, "..");
const { getDb } = await import("../src/lib/db/index.ts");
const { semearDemo, PORTAL_DEMO } = await import("../src/lib/ausencias/seed.ts");
const { criarPedido } = await import("../src/lib/ausencias/repo/pedidos.ts");

const script = `
import fs from 'node:fs';
const { getDb } = await import(process.env.RAIZ_SRC + '/lib/db/index.ts');
const { criarServicosAusencias } = await import(process.env.RAIZ_SRC + '/lib/ausencias/servicos-impl.ts');
const { FakeBitrix } = await import(process.env.RAIZ_SRC + '/lib/bitrix/ausencias/fake.ts');
const db = getDb();
const original = db.transaction.bind(db);
db.transaction = (fn) => {
  const tx = original(fn);
  return { immediate: (...args) => {
    fs.writeSync(1, 'ANTES_IMMEDIATE\\n');
    return tx.immediate(...args);
  }};
};
const sv = criarServicosAusencias({ portalMemberId: process.env.PORTAL, relogio: { hoje: () => '2026-10-26', agora: () => '2026-10-26T12:00:00.000Z' }, porta: new FakeBitrix() });
fs.writeSync(1, 'PRONTO\\n');
await new Promise(resolve => process.stdin.once('data', resolve));
try {
  const p = await sv.decidir({ pessoaId: 'carlos', papel: 'gestor' }, Number(process.env.PEDIDO), { decisao: 'aprovar', versao: Number(process.env.VERSAO) });
  fs.writeSync(1, 'RESULTADO:' + JSON.stringify({ status: p.status, excedeSaldo: p.excedeSaldo }) + '\\n');
} catch (e) {
  fs.writeSync(1, 'ERRO:' + String(e.stack || e) + '\\n');
  process.exitCode = 1;
}
`;

test("aprovação recalcula saldo depois do crédito concorrente confirmado", { timeout: 20000 }, async () => {
  const db = getDb();
  semearDemo();
  db.prepare("DELETE FROM lancamento WHERE portal_member_id = ? AND pessoa_id = 'ana' AND carteira = 'folga'").run(PORTAL_DEMO);
  const pedido = criarPedido(PORTAL_DEMO, {
    pessoaId: "ana", tipoId: "folga", inicio: "2026-11-03", fim: "2026-11-06",
    diasUteis: 4, diasDebitoPorAno: { "2026": 4 }, diasOcupados: ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    excedeSaldo: true, justificativa: "Preciso destes dias adicionais", criadoEm: "2026-10-26T12:00:00.000Z",
  });
  const filho = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", pathToFileURL(path.join(raiz, "tests/registrar-alias.mjs")).href, "--input-type=module", "-e", script], {
    cwd: raiz, env: { ...process.env, RAIZ_SRC: pathToFileURL(path.join(raiz, "src")).href, PORTAL: PORTAL_DEMO, PEDIDO: String(pedido.id), VERSAO: String(pedido.versao) }, stdio: ["pipe", "pipe", "pipe"],
  });
  let saida = "";
  let erros = "";
  let lock = false;
  let viuLock = false;
  filho.stderr.setEncoding("utf8");
  filho.stderr.on("data", (s: string) => { erros += s; });
  try {
    const resultado = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`tempo esgotado: ${saida} ${erros}`)), 8000);
      filho.on("close", () => clearTimeout(timeout));
      filho.on("error", reject);
      filho.stdout.setEncoding("utf8");
      filho.stdout.on("data", (s: string) => {
        saida += s;
        try {
          if (saida.includes("PRONTO\n") && !lock && !viuLock) {
            db.exec("BEGIN IMMEDIATE");
            lock = true;
            db.prepare(`INSERT INTO lancamento (portal_member_id, pessoa_id, ano, carteira, tipo, dias, motivo, criado_por, criado_em, origem) VALUES (?, 'ana', 2026, 'folga', 'credito', 5, 'Crédito concorrente', 'marina', '2026-10-26T12:00:00.000Z', 'app')`).run(PORTAL_DEMO);
            filho.stdin.end("iniciar\n");
          }
          if (saida.includes("ANTES_IMMEDIATE\n") && lock) {
            viuLock = true;
            db.exec("COMMIT");
            lock = false;
          }
        } catch (e) { reject(e); }
      });
      filho.on("close", (code) => code === 0 ? resolve(saida) : reject(new Error(`filho terminou ${code}: ${saida} ${erros}`)));
    });
    assert.ok(viuLock, "filho deve alcançar a transação enquanto o crédito não está confirmado");
    const linha = resultado.split("\n").find((s) => s.startsWith("RESULTADO:"));
    assert.ok(linha, resultado);
    assert.deepEqual(JSON.parse(linha.slice("RESULTADO:".length)), { status: "aprovada", excedeSaldo: false });
    assert.deepEqual(db.prepare("SELECT status, excede_saldo FROM pedido WHERE portal_member_id = ? AND id = ?").get(PORTAL_DEMO, pedido.id), { status: "aprovada", excede_saldo: 0 });
  } finally {
    if (lock) db.exec("ROLLBACK");
    filho.kill();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
