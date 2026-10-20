/**
 * Cliente da API REST oficial do Bitrix24 (aplicativo local / OAuth 2.0).
 *
 * Regras do desafio honradas aqui:
 *  - API REST oficial, sem token do Vibecode;
 *  - nenhum ID fixo de portal, usuario, campo ou funil: tudo e descoberto em
 *    tempo de execucao a partir do portal autenticado;
 *  - renovacao automatica de token (refresh) com uma unica tentativa;
 *  - timeout curto e falha rapida, para nunca pendurar uma tela;
 *  - paginacao com teto explicito, para nao fazer fan-out infinito;
 *  - respeito as permissoes: o app chama a REST em nome do usuario/portal e
 *    repassa o erro de acesso como SEM_PERMISSAO.
 */
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  obterCredenciais,
  obterPortal,
  obterTokens,
  obterWebhookUrl,
  salvarTokens,
} from "@/lib/db/portals";

const URL_OAUTH = "https://oauth.bitrix.info/oauth/token/";
const TIMEOUT_MS = 10_000;
const MAX_PAGINAS = 50; // teto duro: 50 x 50 = 2500 registros por consulta
const FOLGA_EXPIRACAO_S = 60;

export interface RespostaLista<T> {
  itens: T[];
  total: number;
  truncado: boolean;
}

function agora(): number {
  return Math.floor(Date.now() / 1000);
}

async function postForm(
  url: string,
  corpo: Record<string, string>,
  timeoutMs = TIMEOUT_MS,
): Promise<{ status: number; json: unknown }> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(corpo).toString(),
      signal: controlador.signal,
      cache: "no-store",
    });
    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      throw new AppError("RESPOSTA_INVALIDA", {
        tecnico: `Resposta nao-JSON (HTTP ${resposta.status})`,
      });
    }
    return { status: resposta.status, json };
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    if (erro instanceof Error && erro.name === "AbortError") {
      throw new AppError("PORTAL_INDISPONIVEL", {
        tecnico: `Timeout de ${timeoutMs}ms ao chamar ${new URL(url).host}`,
        cause: erro,
      });
    }
    throw new AppError("PORTAL_INDISPONIVEL", {
      tecnico: erro instanceof Error ? erro.message : String(erro),
      cause: erro,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface RespostaToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  member_id?: string;
  client_endpoint?: string;
  domain?: string;
  error?: string;
  error_description?: string;
}

/** Troca o `code` do OAuth pelos tokens iniciais. */
export async function trocarCodePorTokens(args: {
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<RespostaToken> {
  const { json, status } = await postForm(URL_OAUTH, {
    grant_type: "authorization_code",
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
  });
  const dados = json as RespostaToken;
  if (status !== 200 || !dados?.access_token) {
    logger.error({
      evento: "bitrix.oauth.troca_falhou",
      detalhe: { status, erro: dados?.error, descricao: dados?.error_description },
    });
    throw new AppError("CREDENCIAIS_INVALIDAS", {
      tecnico: dados?.error_description ?? dados?.error ?? `HTTP ${status}`,
    });
  }
  return dados;
}

/** Renova o access_token a partir do refresh_token. */
async function renovarTokens(memberId: string): Promise<string> {
  const credenciais = obterCredenciais(memberId);
  const tokens = obterTokens(memberId);
  if (!credenciais || !tokens) {
    throw new AppError("SEM_CONFIGURACAO", {
      tecnico: `Portal ${memberId} sem credenciais ou tokens`,
    });
  }

  const { json, status } = await postForm(URL_OAUTH, {
    grant_type: "refresh_token",
    client_id: credenciais.clientId,
    client_secret: credenciais.clientSecret,
    refresh_token: tokens.refreshToken,
  });
  const dados = json as RespostaToken;

  if (status !== 200 || !dados?.access_token || !dados?.refresh_token) {
    logger.error({
      evento: "bitrix.oauth.refresh_falhou",
      portal: memberId,
      detalhe: { status, erro: dados?.error },
    });
    throw new AppError("TOKEN_EXPIRADO", {
      tecnico: dados?.error_description ?? dados?.error ?? `HTTP ${status}`,
    });
  }

  salvarTokens(memberId, {
    accessToken: dados.access_token,
    refreshToken: dados.refresh_token,
    expiresAt: agora() + (dados.expires_in ?? 3600),
    scope: dados.scope,
  });
  logger.info({ evento: "bitrix.oauth.refresh_ok", portal: memberId });
  return dados.access_token;
}

async function accessTokenValido(memberId: string): Promise<string> {
  const tokens = obterTokens(memberId);
  if (!tokens) {
    throw new AppError("SEM_CONFIGURACAO", {
      tecnico: `Portal ${memberId} sem tokens`,
    });
  }
  // Renova preventivamente quando falta menos de 1 minuto.
  if (tokens.expiresAt - FOLGA_EXPIRACAO_S <= agora()) {
    return renovarTokens(memberId);
  }
  return tokens.accessToken;
}

interface RespostaRest<T> {
  result?: T;
  total?: number;
  next?: number;
  time?: Record<string, number>;
  error?: string;
  error_description?: string;
}

function traduzirErroRest(erro: string, descricao?: string): AppError {
  const e = erro.toUpperCase();
  if (e.includes("EXPIRED_TOKEN") || e.includes("INVALID_TOKEN")) {
    return new AppError("TOKEN_EXPIRADO", { tecnico: descricao ?? erro });
  }
  if (
    e.includes("ACCESS_DENIED") ||
    e.includes("INSUFFICIENT_SCOPE") ||
    e.includes("NOT_ALLOWED")
  ) {
    return new AppError("SEM_PERMISSAO", { tecnico: descricao ?? erro });
  }
  if (e.includes("QUERY_LIMIT") || e.includes("OPERATION_TIME_LIMIT")) {
    return new AppError("LIMITE_API", { tecnico: descricao ?? erro });
  }
  return new AppError("RESPOSTA_INVALIDA", { tecnico: `${erro}: ${descricao ?? ""}` });
}

/**
 * Chamada crua a um metodo REST, com UMA tentativa de refresh em caso de
 * token expirado. Prefira `callRest`/`listAll` abaixo.
 *
 * Funciona nos dois modos de conexao:
 *  - WEBHOOK: a URL do webhook de entrada ja autentica; nao envia `auth`,
 *    nao renova nada (o codigo nao expira).
 *  - OAUTH: envia `auth=<access_token>` e renova quando necessario.
 */
export async function callRest<T = unknown>(
  memberId: string,
  metodo: string,
  parametros: Record<string, unknown> = {},
): Promise<RespostaRest<T>> {
  const portal = obterPortal(memberId);
  if (!portal) {
    throw new AppError("SEM_CONFIGURACAO", {
      tecnico: `Portal ${memberId} nao conectado`,
    });
  }

  if (portal.authMode === "WEBHOOK") {
    return callRestWebhook<T>(memberId, metodo, parametros);
  }

  const executar = async (token: string) => {
    const url = `${portal.clientEndpoint.replace(/\/$/, "")}/${metodo}.json`;
    const inicio = Date.now();
    const { status, json } = await postForm(url, {
      auth: token,
      ...achatarParametros(parametros),
    });
    logger.debug({
      evento: "bitrix.rest.call",
      portal: memberId,
      detalhe: { metodo, modo: "OAUTH", status, ms: Date.now() - inicio },
    });
    return { status, dados: json as RespostaRest<T> };
  };

  let token = await accessTokenValido(memberId);
  let { dados } = await executar(token);

  if (dados?.error && /EXPIRED_TOKEN|INVALID_TOKEN/i.test(dados.error)) {
    token = await renovarTokens(memberId);
    dados = (await executar(token)).dados;
  }

  if (dados?.error) {
    const appErro = traduzirErroRest(dados.error, dados.error_description);
    logger.warn({
      evento: "bitrix.rest.erro",
      portal: memberId,
      detalhe: { metodo, codigo: dados.error },
    });
    throw appErro;
  }

  return dados;
}

/** Caminho do modo webhook: a propria URL carrega a autenticacao. */
async function callRestWebhook<T>(
  memberId: string,
  metodo: string,
  parametros: Record<string, unknown>,
): Promise<RespostaRest<T>> {
  const base = obterWebhookUrl(memberId);
  if (!base) {
    throw new AppError("SEM_CONFIGURACAO", {
      tecnico: `Portal ${memberId} em modo WEBHOOK sem URL salva`,
    });
  }

  const url = `${base.replace(/\/$/, "")}/${metodo}.json`;
  const inicio = Date.now();
  const { status, json } = await postForm(url, achatarParametros(parametros));
  const dados = json as RespostaRest<T>;

  logger.debug({
    evento: "bitrix.rest.call",
    portal: memberId,
    detalhe: { metodo, modo: "WEBHOOK", status, ms: Date.now() - inicio },
  });

  if (dados?.error) {
    // No modo webhook nao existe refresh: token invalido = webhook revogado
    // ou sem o escopo marcado na criacao. Mensagem precisa dizer isso.
    const bruto = dados.error.toUpperCase();
    if (/INVALID_TOKEN|INVALID_CREDENTIALS|NOT_FOUND/.test(bruto)) {
      logger.warn({
        evento: "bitrix.webhook.invalido",
        portal: memberId,
        detalhe: { metodo, codigo: dados.error },
      });
      throw new AppError("CREDENCIAIS_INVALIDAS", {
        tecnico: `Webhook rejeitado: ${dados.error}`,
      });
    }
    throw traduzirErroRest(dados.error, dados.error_description);
  }

  return dados;
}

/**
 * Lista todas as paginas de um metodo `*.list`, com teto de paginas.
 * Nunca use `while (next)` sem limite: em portal grande isso estoura o
 * timeout da tela e derruba o painel inteiro.
 */
export async function listAll<T = Record<string, unknown>>(
  memberId: string,
  metodo: string,
  parametros: Record<string, unknown> = {},
  opcoes: { maxPaginas?: number } = {},
): Promise<RespostaLista<T>> {
  const maxPaginas = Math.min(opcoes.maxPaginas ?? MAX_PAGINAS, MAX_PAGINAS);
  const itens: T[] = [];
  let start: number | undefined = 0;
  let total = 0;
  let paginas = 0;

  while (start !== undefined && paginas < maxPaginas) {
    const resposta: RespostaRest<T[]> = await callRest<T[]>(memberId, metodo, {
      ...parametros,
      start,
    });
    const lote = (resposta.result ?? []) as T[];
    itens.push(...lote);
    total = resposta.total ?? itens.length;
    start = resposta.next;
    paginas += 1;
  }

  const truncado = start !== undefined;
  if (truncado) {
    logger.warn({
      evento: "bitrix.rest.lista_truncada",
      portal: memberId,
      detalhe: { metodo, paginas, obtidos: itens.length, total },
    });
  }
  return { itens, total, truncado };
}

/**
 * Envia varios metodos numa unica requisicao (`batch`), reduzindo o fan-out.
 * Resultados parciais sao preservados: um comando que falha nao derruba os
 * outros.
 */
export async function batch(
  memberId: string,
  comandos: Record<string, { metodo: string; parametros?: Record<string, unknown> }>,
): Promise<{
  resultados: Record<string, unknown>;
  erros: Record<string, string>;
}> {
  const cmd: Record<string, string> = {};
  for (const [nome, c] of Object.entries(comandos)) {
    const qs = new URLSearchParams(achatarParametros(c.parametros ?? {})).toString();
    cmd[nome] = qs ? `${c.metodo}?${qs}` : c.metodo;
  }

  const resposta = await callRest<{
    result: Record<string, unknown>;
    result_error: Record<string, { error: string; error_description?: string }>;
  }>(memberId, "batch", { halt: 0, cmd });

  const bruto = resposta.result as
    | {
        result?: Record<string, unknown>;
        result_error?: Record<string, { error: string; error_description?: string }>;
      }
    | undefined;

  const erros: Record<string, string> = {};
  for (const [nome, e] of Object.entries(bruto?.result_error ?? {})) {
    erros[nome] = traduzirErroRest(e.error, e.error_description).mensagemUsuario;
  }
  return { resultados: bruto?.result ?? {}, erros };
}

/**
 * O Bitrix espera parametros aninhados no formato PHP
 * (`filter[STAGE_ID]=NEW`). Achata objetos/arrays nesse formato.
 */
function achatarParametros(
  objeto: Record<string, unknown>,
  prefixo = "",
): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    if (valor === undefined || valor === null) continue;
    const nome = prefixo ? `${prefixo}[${chave}]` : chave;
    if (Array.isArray(valor)) {
      valor.forEach((v, i) => {
        if (v !== null && typeof v === "object") {
          Object.assign(
            saida,
            achatarParametros(v as Record<string, unknown>, `${nome}[${i}]`),
          );
        } else {
          saida[`${nome}[${i}]`] = String(v);
        }
      });
    } else if (typeof valor === "object") {
      Object.assign(saida, achatarParametros(valor as Record<string, unknown>, nome));
    } else {
      saida[nome] = String(valor);
    }
  }
  return saida;
}

/** Monta a URL de autorizacao do aplicativo local. */
export function urlAutorizacao(args: {
  domain: string;
  clientId: string;
  redirectUri: string;
  state?: string;
}): string {
  const url = new URL(`https://${args.domain}/oauth/authorize/`);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", args.redirectUri);
  if (args.state) url.searchParams.set("state", args.state);
  return url.toString();
}
