import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import { pathToFileURL } from "node:url";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saldo-concorrencia-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.MODO_DEMO = "1";
const raiz = path.resolve(import.meta.dirname, "..");
const { getDb } = await import("../src/lib/db/index.ts");
const { semearDemo, PORTAL_DEMO } = await import("../src/lib/ausencias/seed.ts");
const { removerPortal } = await import("../src/lib/db/portals.ts");
after(() => { getDb().close(); fs.rmSync(dir, { recursive: true, force: true }); });

// Os dois processos chegam ao instante de gravação antes de qualquer transação.
// No código vulnerável já calcularam o saldo; no corrigido calcularão sob lock.
const script = `
import fs from 'node:fs';
const { criarServicosAusencias } = await import(process.env.RAIZ_SRC + '/lib/ausencias/servicos-impl.ts');
const { FakeBitrix } = await import(process.env.RAIZ_SRC + '/lib/bitrix/ausencias/fake.ts');
let primeira = true;
const relogio = { hoje: () => '2026-10-26', agora: () => {
  if (primeira) {
    primeira = false;
    fs.writeFileSync(process.env.BARREIRA + '/' + process.env.NUMERO, 'pronto');
    const limite = Date.now() + 15000;
    while (!fs.existsSync(process.env.BARREIRA + '/' + (process.env.NUMERO === '0' ? '1' : '0'))) {
      if (Date.now() > limite) throw new Error('barreira expirou');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return '2026-10-26T12:00:00.000Z';
}};
const sv = criarServicosAusencias({ portalMemberId: process.env.PORTAL, relogio, porta: new FakeBitrix() });
try {
 const pedido = await sv.solicitar({ pessoaId: 'ana', papel: 'colaborador' }, JSON.parse(process.env.ENTRADA));
 console.log('RESULTADO:' + JSON.stringify({ok: true, excedeSaldo: pedido.excedeSaldo}));
} catch (e) {
 console.log('RESULTADO:' + JSON.stringify({ok: false, campo: e.issues?.[0]?.path?.[0], mensagem: e.message}));
}
`;

function filho(numero: number, entrada: object, barreira: string): Promise<{ ok: boolean; excedeSaldo?: boolean; campo?: string; mensagem?: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", pathToFileURL(path.join(raiz, "tests/registrar-alias.mjs")).href, "--input-type=module", "-e", script], {
      cwd: raiz, timeout: 30000, env: { ...process.env, RAIZ_SRC: pathToFileURL(path.join(raiz, "src")).href, PORTAL: PORTAL_DEMO, NUMERO: String(numero), ENTRADA: JSON.stringify(entrada), BARREIRA: barreira },
    }, (err, stdout, stderr) => {
      const linha = stdout.split("\n").find((s) => s.startsWith("RESULTADO:"));
      if (!linha) return reject(new Error(`filho falhou: ${err?.message} ${stderr}`));
      resolve(JSON.parse(linha.slice("RESULTADO:".length)));
    });
  });
}

async function disputa(justificativa?: string) {
  removerPortal(PORTAL_DEMO);
  // A semente credita o ano seguinte: use 2025 para financiar pedidos de 2026.
  semearDemo({ hoje: "2025-10-26" });
  const barreira = fs.mkdtempSync(path.join(dir, "barreira-"));
  const entradas = [
    { tipoId: "folga", inicio: "2026-11-03", fim: "2026-11-06", justificativa },
    { tipoId: "folga", inicio: "2026-11-09", fim: "2026-11-12", justificativa },
  ];
  return Promise.all(entradas.map((entrada, i) => filho(i, entrada, barreira)));
}

test("pedidos concorrentes sem justificativa não podem exceder saldo", async () => {
  const resultados = await disputa();
  assert.equal(resultados.filter((r) => r.ok).length, 1, JSON.stringify(resultados));
  assert.equal(resultados.find((r) => !r.ok)?.campo, "justificativa");
  const registros = getDb().prepare("SELECT excede_saldo FROM pedido WHERE portal_member_id = ? AND pessoa_id = 'ana'").all(PORTAL_DEMO);
  assert.deepEqual(registros, [{ excede_saldo: 0 }]);
});

test("pedidos concorrentes justificados registram corretamente o excedente", async () => {
  const resultados = await disputa("Preciso destes dias adicionais");
  assert.equal(resultados.filter((r) => r.ok).length, 2, JSON.stringify(resultados));
  assert.deepEqual(resultados.map((r) => r.excedeSaldo).sort(), [false, true]);
  const registros = getDb().prepare("SELECT excede_saldo FROM pedido WHERE portal_member_id = ? AND pessoa_id = 'ana' ORDER BY excede_saldo").all(PORTAL_DEMO);
  assert.deepEqual(registros, [{ excede_saldo: 0 }, { excede_saldo: 1 }]);
});
