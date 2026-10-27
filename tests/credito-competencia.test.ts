import assert from "node:assert/strict";
import { after, test } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "br24-credito-ano-"));
process.env.DATABASE_PATH = path.join(dir, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.MODO_DEMO = "1";
const { getDb } = await import("../src/lib/db/index.ts");
const { PORTAL_DEMO, semearDemo } = await import("../src/lib/ausencias/seed.ts");
const { criarServicosAusencias } = await import("../src/lib/ausencias/servicos-impl.ts");
const { FakeBitrix } = await import("../src/lib/bitrix/ausencias/fake.ts");
const { creditarSchema } = await import("../src/lib/ausencias/schemas.ts");

after(() => {
  getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function servicos() {
  const hoje = "2026-10-26";
  return criarServicosAusencias({
    portalMemberId: PORTAL_DEMO,
    relogio: { hoje: () => hoje, agora: () => `${hoje}T12:00:00.000Z` },
    porta: new FakeBitrix(),
  });
}

test("em 2026 da para creditar na competencia 2027 e cobrir pedido de 2027 sem excedente", async () => {
  semearDemo({ hoje: "2026-10-26" });
  getDb().prepare("DELETE FROM lancamento WHERE portal_member_id = ? AND pessoa_id = 'ana' AND carteira = 'folga'").run(PORTAL_DEMO);
  const sv = servicos();
  const admin = { pessoaId: "marina", papel: "admin" as const };
  sv.creditar(admin, { pessoaId: "ana", carteira: "folga", dias: 5, motivo: "Credito da competencia 2027", ano: 2027 });
  const pedido = await sv.solicitar({ pessoaId: "ana", papel: "colaborador" }, { tipoId: "folga", inicio: "2027-02-01", fim: "2027-02-04" });
  assert.equal(pedido.excedeSaldo, false);
});

test("sem `ano` o credito continua na competencia do ano atual (compatibilidade)", () => {
  semearDemo({ hoje: "2026-10-26" });
  const sv = servicos();
  sv.creditar({ pessoaId: "marina", papel: "admin" }, { pessoaId: "bruno", carteira: "folga", dias: 2, motivo: "Credito sem ano informado" });
  const ano = getDb()
    .prepare("SELECT ano FROM lancamento WHERE portal_member_id = ? AND pessoa_id = 'bruno' AND motivo = 'Credito sem ano informado'")
    .get(PORTAL_DEMO) as { ano: number };
  assert.equal(ano.ano, 2026);
});

test("schema: ano fora de faixa ou vencimento anterior a competencia e rejeitado", () => {
  const base = { pessoaId: "ana", carteira: "folga" as const, dias: 1, motivo: "Credito de teste valido" };
  assert.equal(creditarSchema.safeParse({ ...base, ano: 1999 }).success, false);
  assert.equal(creditarSchema.safeParse({ ...base, ano: 2101 }).success, false);
  assert.equal(creditarSchema.safeParse({ ...base, ano: 2027, venceEm: "2026-12-31" }).success, false);
  assert.equal(creditarSchema.safeParse({ ...base, ano: 2027, venceEm: "2027-12-31" }).success, true);
});
