/**
 * Testes de seguranca da camada de persistencia.
 *
 * Nao sao testes de unidade genericos: cada um fixa uma invariante de
 * seguranca que JA foi violada uma vez neste projeto. Se um deles falhar,
 * dados de cliente estao expostos — trate como bug de severidade alta, nao
 * como teste chato.
 *
 * Roda com o runner nativo do Node, sem dependencia nova:
 *   npm run test:seguranca
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Ambiente isolado: banco temporario e chave propria, antes de importar o app.
const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), "br24-sec-"));
process.env.DATABASE_PATH = path.join(dirTemp, "teste.db");
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.APP_BASE_URL = "http://localhost:3000";

const { getDb } = await import("../src/lib/db/index.ts");
const {
  salvarWebhook,
  obterWebhookUrl,
  salvarPortal,
  salvarCredenciais,
  obterCredenciais,
  salvarTokens,
  obterTokens,
  salvarAppToken,
  appTokenConfere,
  removerPortal,
} = await import("../src/lib/db/portals.ts");
const { encrypt, decrypt } = await import("../src/lib/crypto.ts");
const { redact } = await import("../src/lib/logger.ts");

const CODIGO_WEBHOOK = "x7k9mq2p4w8n";
const URL_WEBHOOK = `https://teste.bitrix24.com.br/rest/1/${CODIGO_WEBHOOK}/`;

/** Varre TODAS as colunas de texto do banco procurando um segredo em claro. */
function bancoContemTextoPuro(segredo: string): string[] {
  const db = getDb();
  const tabelas = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];

  const ocorrencias: string[] = [];
  for (const { name } of tabelas) {
    const linhas = db.prepare(`SELECT * FROM "${name}"`).all() as Record<
      string,
      unknown
    >[];
    for (const linha of linhas) {
      for (const [coluna, valor] of Object.entries(linha)) {
        if (typeof valor === "string" && valor.includes(segredo)) {
          ocorrencias.push(`${name}.${coluna}`);
        }
      }
    }
  }
  return ocorrencias;
}

test("o codigo do webhook nunca aparece em texto puro no banco", () => {
  salvarWebhook({
    memberId: "webhook:teste.bitrix24.com.br",
    domain: "teste.bitrix24.com.br",
    webhookUrl: URL_WEBHOOK,
  });

  const vazamentos = bancoContemTextoPuro(CODIGO_WEBHOOK);
  assert.deepEqual(
    vazamentos,
    [],
    `Codigo do webhook vazou em: ${vazamentos.join(", ")}. ` +
      "A URL completa so pode existir cifrada em portal.webhook_url_enc.",
  );

  // E continua utilizavel apos decifrar.
  assert.equal(obterWebhookUrl("webhook:teste.bitrix24.com.br"), URL_WEBHOOK);
});

test("client_endpoint guarda apenas a base publica, sem o codigo", () => {
  const linha = getDb()
    .prepare("SELECT client_endpoint FROM portal WHERE member_id = ?")
    .get("webhook:teste.bitrix24.com.br") as { client_endpoint: string };

  assert.equal(linha.client_endpoint, "https://teste.bitrix24.com.br/rest");
  assert.ok(!linha.client_endpoint.includes(CODIGO_WEBHOOK));
});

test("client_secret e tokens OAuth ficam cifrados em repouso", () => {
  const SEGREDO = "sErEdO_sUpEr_sEcrEtO_123";
  const ACCESS = "acc_tok_abcdef123456";
  const REFRESH = "ref_tok_zyxwvu654321";

  salvarPortal({
    memberId: "portal-oauth",
    domain: "oauth.bitrix24.com.br",
    clientEndpoint: "https://oauth.bitrix24.com.br/rest",
    authMode: "OAUTH",
  });
  salvarCredenciais("portal-oauth", {
    clientId: "app.123",
    clientSecret: SEGREDO,
  });
  salvarTokens("portal-oauth", {
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  for (const segredo of [SEGREDO, ACCESS, REFRESH]) {
    const vazamentos = bancoContemTextoPuro(segredo);
    assert.deepEqual(vazamentos, [], `Segredo em claro em: ${vazamentos.join(", ")}`);
  }

  // Round-trip preservado.
  assert.equal(obterCredenciais("portal-oauth")?.clientSecret, SEGREDO);
  assert.equal(obterTokens("portal-oauth")?.accessToken, ACCESS);
});

test("application_token forjado e rejeitado; o correto e aceito", () => {
  salvarAppToken("portal-oauth", "token_verdadeiro_abc");

  assert.equal(appTokenConfere("portal-oauth", "token_verdadeiro_abc"), true);
  assert.equal(appTokenConfere("portal-oauth", "token_forjado_xyz"), false);
  assert.equal(appTokenConfere("portal-oauth", ""), false);
  // Prefixo correto nao passa: comparacao e do valor inteiro.
  assert.equal(appTokenConfere("portal-oauth", "token_verdadeiro"), false);
  // Portal sem token guardado nunca aceita evento.
  assert.equal(appTokenConfere("portal-inexistente", "qualquer"), false);
});

test("desinstalar apaga em cascata os dados do portal", () => {
  const db = getDb();
  db.prepare(
    "INSERT INTO portal_setting (member_id, key, value) VALUES (?, ?, ?)",
  ).run("portal-oauth", "parametro", "valor");

  removerPortal("portal-oauth");

  const sobrouCredencial = db
    .prepare("SELECT COUNT(*) AS n FROM portal_credential WHERE member_id = ?")
    .get("portal-oauth") as { n: number };
  const sobrouParametro = db
    .prepare("SELECT COUNT(*) AS n FROM portal_setting WHERE member_id = ?")
    .get("portal-oauth") as { n: number };

  assert.equal(sobrouCredencial.n, 0, "credencial sobreviveu ao desinstalar");
  assert.equal(sobrouParametro.n, 0, "parametro sobreviveu ao desinstalar");
});

test("o logger remove campos sensiveis antes de gravar", () => {
  const limpo = redact({
    access_token: "acc_123",
    refresh_token: "ref_456",
    client_secret: "sec_789",
    aninhado: { authorization: "Bearer xyz", inofensivo: "ok" },
    metodo: "crm.deal.list",
  }) as Record<string, unknown>;

  assert.equal(limpo.access_token, "[omitido]");
  assert.equal(limpo.refresh_token, "[omitido]");
  assert.equal(limpo.client_secret, "[omitido]");
  assert.equal(
    (limpo.aninhado as Record<string, unknown>).authorization,
    "[omitido]",
  );
  // O que nao e segredo continua legivel, senao o log perde utilidade.
  assert.equal(limpo.metodo, "crm.deal.list");
  assert.equal((limpo.aninhado as Record<string, unknown>).inofensivo, "ok");
});

test("segredo adulterado no banco nao decifra silenciosamente", () => {
  const cifrado = encrypt("valor-original");
  // Troca um caractere do ciphertext: a tag GCM precisa reprovar.
  const adulterado = cifrado.slice(0, -2) + (cifrado.endsWith("A") ? "B" : "A");

  assert.throws(() => decrypt(adulterado));
  assert.equal(decrypt(cifrado), "valor-original");
});

test.after(() => {
  fs.rmSync(dirTemp, { recursive: true, force: true });
});
