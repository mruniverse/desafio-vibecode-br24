#!/usr/bin/env node
/**
 * Publica este app na Onnira Cloud AI pela API publica.
 *
 * Uso:
 *   ONNIRA_API_KEY=onnira_sk_... node scripts/onnira-deploy.mjs criar
 *   ONNIRA_API_KEY=onnira_sk_... node scripts/onnira-deploy.mjs atualizar <APP_ID>
 *   ONNIRA_API_KEY=onnira_sk_... node scripts/onnira-deploy.mjs status <APP_ID>
 *   ONNIRA_API_KEY=onnira_sk_... node scripts/onnira-deploy.mjs logs <APP_ID>
 *   ONNIRA_API_KEY=onnira_sk_... node scripts/onnira-deploy.mjs listar
 *
 * A chave NUNCA fica no codigo: vem sempre da variavel de ambiente.
 * Doc da API: https://onnira.com/docs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "https://public-api.onnira.com/v1";
const CHAVE = process.env.ONNIRA_API_KEY;

// Configuracao do deploy. `next` e o runtime oficial para Next.js.
const CONFIG = {
  nome: process.env.ONNIRA_APP_NAME ?? "Aplicativo Br24",
  runtime: "next",
  size: process.env.ONNIRA_APP_SIZE ?? "starter",
  base_directory: "/",
  install_command: "npm ci",
  build_command: "npm run build",
  start_command: "npm start",
  port: "3000",
};

function exigirChave() {
  if (!CHAVE) {
    console.error(
      "Defina ONNIRA_API_KEY antes de rodar.\n" +
        "Crie a chave em: Onnira > Minha Conta > Seguranca > Integracao por API",
    );
    process.exit(1);
  }
}

async function chamar(caminho, opcoes = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${CHAVE}`,
      ...(opcoes.headers ?? {}),
    },
  });

  const texto = await resposta.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = { bruto: texto };
  }

  if (!resposta.ok) {
    console.error(`HTTP ${resposta.status}`);
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

/**
 * Monta o ZIP do projeto sem node_modules, .next, .git e — crucial — sem a
 * pasta data/ e sem .env*: nenhum dado de cliente ou segredo vai no pacote.
 */
function montarZip() {
  const destino = path.join(os.tmpdir(), `br24-app-${Date.now()}.zip`);
  const raiz = path.resolve(import.meta.dirname, "..");

  console.log("Empacotando o projeto...");
  execFileSync(
    "zip",
    [
      "-r",
      "-q",
      destino,
      ".",
      "-x",
      "node_modules/*",
      "-x",
      ".next/*",
      "-x",
      ".git/*",
      "-x",
      "data/*",
      "-x",
      ".env",
      "-x",
      ".env.*",
      "-x",
      "*.db",
      "-x",
      "*.db-wal",
      "-x",
      "*.db-shm",
    ],
    { cwd: raiz, stdio: "inherit" },
  );

  const tamanhoMb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
  console.log(`ZIP: ${destino} (${tamanhoMb} MB)`);
  return destino;
}

function formularioDeploy(caminhoZip) {
  const form = new FormData();
  form.set("nome", CONFIG.nome);
  form.set("source_type", "ZIP");
  form.set("size", CONFIG.size);
  form.set("runtime", CONFIG.runtime);
  form.set("base_directory", CONFIG.base_directory);
  form.set("install_command", CONFIG.install_command);
  form.set("build_command", CONFIG.build_command);
  form.set("start_command", CONFIG.start_command);
  form.set("port", CONFIG.port);
  form.set(
    "source_zip",
    new Blob([fs.readFileSync(caminhoZip)], { type: "application/zip" }),
    path.basename(caminhoZip),
  );
  return form;
}

const comandos = {
  async listar() {
    const r = await chamar("/cloud/apps");
    const apps = r.data ?? r;
    console.log(JSON.stringify(apps, null, 2));
  },

  async criar() {
    const zip = montarZip();
    console.log("Criando aplicacao na Onnira...");
    const r = await chamar("/cloud/apps", {
      method: "POST",
      body: formularioDeploy(zip),
    });
    fs.unlinkSync(zip);
    console.log(JSON.stringify(r, null, 2));
    console.log(
      "\nDeploy iniciado (HTTP 202). Acompanhe com:\n" +
        `  node scripts/onnira-deploy.mjs status ${r?.data?.id ?? "<APP_ID>"}`,
    );
  },

  async atualizar(appId) {
    if (!appId) throw new Error("Informe o APP_ID.");
    const zip = montarZip();
    console.log(`Publicando nova versao em ${appId}...`);
    const r = await chamar(`/cloud/apps/${appId}/deploy`, {
      method: "POST",
      body: formularioDeploy(zip),
    });
    fs.unlinkSync(zip);
    console.log(JSON.stringify(r, null, 2));
  },

  async status(appId) {
    if (!appId) throw new Error("Informe o APP_ID.");
    const r = await chamar(`/cloud/apps/${appId}`);
    console.log(JSON.stringify(r, null, 2));
  },

  async logs(appId) {
    if (!appId) throw new Error("Informe o APP_ID.");
    const r = await chamar(`/cloud/apps/${appId}/logs`);
    console.log(typeof r === "string" ? r : JSON.stringify(r, null, 2));
  },

  async me() {
    const r = await chamar("/me");
    console.log(JSON.stringify(r, null, 2));
  },
};

const [comando, ...resto] = process.argv.slice(2);

if (!comando || !comandos[comando]) {
  console.log(
    `Comandos: ${Object.keys(comandos).join(" | ")}\n\n` +
      "Exemplo:\n  ONNIRA_API_KEY=onnira_sk_... node scripts/onnira-deploy.mjs criar",
  );
  process.exit(comando ? 1 : 0);
}

exigirChave();
comandos[comando](...resto).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
