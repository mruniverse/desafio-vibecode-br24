/**
 * Erros da porta Bitrix de ausencias.
 *
 * Mensagens NUNCA carregam URL de webhook, token ou texto livre do pedido:
 * `sanitizarMensagem` e aplicada em toda mensagem que sai desta camada.
 * Sem propriedade de parametro no construtor (runner strip-types do Node).
 */

export type CodigoErroBitrix =
  | "TIMEOUT"
  | "TRANSITORIO"
  | "NOT_FOUND"
  | "ESCRITA_BLOQUEADA"
  | "SEM_PORTAL"
  | "RESPOSTA_INVALIDA"
  | "ENTRADA_INVALIDA"
  | "SEM_PERMISSAO"
  | "CREDENCIAIS_INVALIDAS"
  | "LIMITE_API"
  | "ERRO_BITRIX";

/** Codigos que nao adianta repetir: exigem acao humana (config/permissao). */
const CODIGOS_PERMANENTES: ReadonlySet<string> = new Set([
  "ESCRITA_BLOQUEADA",
  "SEM_PORTAL",
  "ENTRADA_INVALIDA",
  "SEM_PERMISSAO",
  "CREDENCIAIS_INVALIDAS",
]);

export class ErroPortaBitrix extends Error {
  readonly codigo: CodigoErroBitrix;
  /** true = vale repetir (rede, limite, resposta incerta). */
  readonly transitorio: boolean;

  constructor(codigo: CodigoErroBitrix, mensagem: string, transitorio?: boolean) {
    super(sanitizarMensagem(mensagem));
    this.name = "ErroPortaBitrix";
    this.codigo = codigo;
    this.transitorio = transitorio ?? !CODIGOS_PERMANENTES.has(codigo);
  }
}

const TAMANHO_MAXIMO_MENSAGEM = 300;

/** Remove URL (webhook), caminho `/rest/<id>/<codigo>` e `auth=` de uma mensagem. */
export function sanitizarMensagem(texto: string): string {
  const limpo = String(texto)
    .replace(/https?:\/\/[^\s"')]+/gi, "[url omitida]")
    .replace(/\/rest\/\d+\/[A-Za-z0-9]+\/?/g, "[webhook omitido]")
    .replace(/(auth|access_token|refresh_token)=[^\s&"']+/gi, "$1=[omitido]")
    .replace(/\s+/g, " ")
    .trim();
  return limpo.length > TAMANHO_MAXIMO_MENSAGEM
    ? `${limpo.slice(0, TAMANHO_MAXIMO_MENSAGEM)}...`
    : limpo;
}

/** Mensagem segura de qualquer erro capturado (para `erro` do resultado). */
export function mensagemSegura(erro: unknown): string {
  if (erro instanceof Error) return sanitizarMensagem(erro.message);
  return sanitizarMensagem(String(erro));
}

export function ehErroPortaBitrix(erro: unknown): erro is ErroPortaBitrix {
  return erro instanceof ErroPortaBitrix;
}
