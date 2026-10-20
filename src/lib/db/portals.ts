/**
 * Repositorio de portais e credenciais.
 *
 * Toda leitura/escrita de segredo passa por aqui, sempre cifrada em repouso.
 */
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

export type ModoAuth = "OAUTH" | "WEBHOOK";

export interface Portal {
  memberId: string;
  domain: string;
  clientEndpoint: string;
  authMode: ModoAuth;
  scope: string | null;
  expiresAt: number | null;
  setupCompleted: boolean;
  installedAt: string;
}

export interface TokensPortal {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface CredenciaisApp {
  clientId: string;
  clientSecret: string;
}

function linhaParaPortal(r: Record<string, unknown>): Portal {
  return {
    memberId: String(r.member_id),
    domain: String(r.domain),
    clientEndpoint: String(r.client_endpoint),
    authMode: (String(r.auth_mode ?? "OAUTH") as ModoAuth) ?? "OAUTH",
    scope: (r.scope as string) ?? null,
    expiresAt: (r.expires_at as number) ?? null,
    setupCompleted: Number(r.setup_completed) === 1,
    installedAt: String(r.installed_at),
  };
}

export function listarPortais(): Portal[] {
  const linhas = getDb()
    .prepare("SELECT * FROM portal ORDER BY installed_at DESC")
    .all() as Record<string, unknown>[];
  return linhas.map(linhaParaPortal);
}

export function obterPortal(memberId: string): Portal | null {
  const r = getDb()
    .prepare("SELECT * FROM portal WHERE member_id = ?")
    .get(memberId) as Record<string, unknown> | undefined;
  return r ? linhaParaPortal(r) : null;
}

/** Portal unico: atalho para apps de portal unico (caso mais comum). */
export function portalAtivo(): Portal | null {
  const r = getDb()
    .prepare(
      "SELECT * FROM portal WHERE setup_completed = 1 ORDER BY updated_at DESC LIMIT 1",
    )
    .get() as Record<string, unknown> | undefined;
  return r ? linhaParaPortal(r) : null;
}

export function salvarPortal(dados: {
  memberId: string;
  domain: string;
  clientEndpoint: string;
  authMode?: ModoAuth;
}) {
  getDb()
    .prepare(
      `INSERT INTO portal (member_id, domain, client_endpoint, auth_mode)
       VALUES (@memberId, @domain, @clientEndpoint, @authMode)
       ON CONFLICT(member_id) DO UPDATE SET
         domain = excluded.domain,
         client_endpoint = excluded.client_endpoint,
         auth_mode = excluded.auth_mode,
         updated_at = datetime('now')`,
    )
    .run({ ...dados, authMode: dados.authMode ?? "OAUTH" });
}

/**
 * Conecta um portal pelo webhook de entrada.
 *
 * SEGURANCA: a URL do webhook carrega o codigo de autenticacao e vale acesso
 * ao portal — ela e tratada como senha. Vai cifrada em `webhook_url_enc` e
 * SOMENTE lá. Em `client_endpoint` guardamos apenas a base publica
 * (https://dominio/rest), que nao e segredo; gravar a URL completa ali
 * anularia a cifragem, porque um dump do banco entregaria o acesso.
 * Formato esperado: https://<portal>.bitrix24.com.br/rest/<userId>/<codigo>/
 */
export function salvarWebhook(args: {
  memberId: string;
  domain: string;
  webhookUrl: string;
}) {
  const normalizada = args.webhookUrl.trim().replace(/\/+$/, "") + "/";
  // Base publica, sem o par <userId>/<codigo>.
  const endpointPublico = `https://${args.domain}/rest`;
  getDb()
    .prepare(
      `INSERT INTO portal (member_id, domain, client_endpoint, auth_mode, webhook_url_enc)
       VALUES (?, ?, ?, 'WEBHOOK', ?)
       ON CONFLICT(member_id) DO UPDATE SET
         domain = excluded.domain,
         client_endpoint = excluded.client_endpoint,
         auth_mode = 'WEBHOOK',
         webhook_url_enc = excluded.webhook_url_enc,
         access_token_enc = NULL,
         refresh_token_enc = NULL,
         expires_at = NULL,
         updated_at = datetime('now')`,
    )
    .run(args.memberId, args.domain, endpointPublico, encrypt(normalizada));
}

/** URL do webhook de entrada em claro (uso interno do cliente REST). */
export function obterWebhookUrl(memberId: string): string | null {
  const r = getDb()
    .prepare("SELECT webhook_url_enc FROM portal WHERE member_id = ?")
    .get(memberId) as Record<string, unknown> | undefined;
  return r?.webhook_url_enc ? decrypt(String(r.webhook_url_enc)) : null;
}

/**
 * application_token dos eventos (OAuth): guardado cifrado para autenticar o
 * POST que o Bitrix24 manda em ONAPPINSTALL/ONAPPUNINSTALL.
 */
export function salvarAppToken(memberId: string, appToken: string) {
  getDb()
    .prepare(
      "UPDATE portal SET app_token_enc = ?, updated_at = datetime('now') WHERE member_id = ?",
    )
    .run(encrypt(appToken), memberId);
}

/**
 * Compara o application_token recebido num evento com o guardado.
 * Comparacao em tempo constante: evita vazar o token por analise de tempo.
 */
export function appTokenConfere(memberId: string, recebido: string): boolean {
  const r = getDb()
    .prepare("SELECT app_token_enc FROM portal WHERE member_id = ?")
    .get(memberId) as Record<string, unknown> | undefined;
  if (!r?.app_token_enc) return false;

  let esperado: string;
  try {
    esperado = decrypt(String(r.app_token_enc));
  } catch {
    return false;
  }

  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(recebido, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function salvarTokens(memberId: string, t: TokensPortal & { scope?: string }) {
  getDb()
    .prepare(
      `UPDATE portal SET
         access_token_enc = ?, refresh_token_enc = ?, expires_at = ?,
         scope = COALESCE(?, scope), updated_at = datetime('now')
       WHERE member_id = ?`,
    )
    .run(
      encrypt(t.accessToken),
      encrypt(t.refreshToken),
      t.expiresAt,
      t.scope ?? null,
      memberId,
    );
}

export function obterTokens(memberId: string): TokensPortal | null {
  const r = getDb()
    .prepare(
      "SELECT access_token_enc, refresh_token_enc, expires_at FROM portal WHERE member_id = ?",
    )
    .get(memberId) as Record<string, unknown> | undefined;

  if (!r?.access_token_enc || !r?.refresh_token_enc) return null;
  return {
    accessToken: decrypt(String(r.access_token_enc)),
    refreshToken: decrypt(String(r.refresh_token_enc)),
    expiresAt: Number(r.expires_at ?? 0),
  };
}

export function salvarCredenciais(memberId: string, c: CredenciaisApp) {
  getDb()
    .prepare(
      `INSERT INTO portal_credential (member_id, client_id, client_secret_enc)
       VALUES (?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET
         client_id = excluded.client_id,
         client_secret_enc = excluded.client_secret_enc,
         updated_at = datetime('now')`,
    )
    .run(memberId, c.clientId, encrypt(c.clientSecret));
}

/**
 * Credenciais do app para um portal: primeiro o que o cliente informou no
 * wizard; se nao houver, cai no par definido por variavel de ambiente.
 */
export function obterCredenciais(memberId: string): CredenciaisApp | null {
  const r = getDb()
    .prepare(
      "SELECT client_id, client_secret_enc FROM portal_credential WHERE member_id = ?",
    )
    .get(memberId) as Record<string, unknown> | undefined;

  if (r) {
    return {
      clientId: String(r.client_id),
      clientSecret: decrypt(String(r.client_secret_enc)),
    };
  }

  const { BITRIX_CLIENT_ID, BITRIX_CLIENT_SECRET } = process.env;
  if (BITRIX_CLIENT_ID && BITRIX_CLIENT_SECRET) {
    return { clientId: BITRIX_CLIENT_ID, clientSecret: BITRIX_CLIENT_SECRET };
  }
  return null;
}

export function marcarSetupConcluido(memberId: string, concluido = true) {
  getDb()
    .prepare(
      "UPDATE portal SET setup_completed = ?, updated_at = datetime('now') WHERE member_id = ?",
    )
    .run(concluido ? 1 : 0, memberId);
}

export function definirParametro(memberId: string, key: string, value: string | null) {
  getDb()
    .prepare(
      `INSERT INTO portal_setting (member_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(member_id, key) DO UPDATE SET
         value = excluded.value, updated_at = datetime('now')`,
    )
    .run(memberId, key, value);
}

export function obterParametros(memberId: string): Record<string, string | null> {
  const linhas = getDb()
    .prepare("SELECT key, value FROM portal_setting WHERE member_id = ?")
    .all(memberId) as { key: string; value: string | null }[];
  return Object.fromEntries(linhas.map((l) => [l.key, l.value]));
}

export function removerPortal(memberId: string) {
  getDb().prepare("DELETE FROM portal WHERE member_id = ?").run(memberId);
}
