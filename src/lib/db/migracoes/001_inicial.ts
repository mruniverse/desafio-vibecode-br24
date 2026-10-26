/**
 * Migracao 001 — base do app (portal, credenciais, configuracao, cache, log).
 * NUNCA editar: o runner aplica por nome e nao ha checksum. Mudancas viram
 * uma migracao nova.
 */
export const nome = "001_inicial";

export const sql = `
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
        -- ATENCAO: no modo WEBHOOK, client_endpoint NUNCA pode conter a URL
        -- completa — ela carrega o codigo de autenticacao. Guarda-se ali
        -- apenas a base publica (https://dominio/rest), que nao e segredo.
        webhook_url_enc   TEXT,
        -- application_token enviado pelo Bitrix24 nos eventos (OAuth).
        -- Usado para autenticar o POST de evento e impedir que um terceiro
        -- dispare ONAPPUNINSTALL e apague os dados de um portal.
        app_token_enc     TEXT,
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
    `;
