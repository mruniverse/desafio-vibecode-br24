/**
 * Erros de dominio do app.
 *
 * Cada erro carrega uma mensagem em portugues PRONTA PARA O USUARIO, separada
 * da mensagem tecnica que vai para o log. Requisito do desafio: "mensagens
 * claras e logs das operacoes relevantes".
 */

export type CodigoErro =
  | "SEM_CONFIGURACAO"
  | "CREDENCIAIS_INVALIDAS"
  | "TOKEN_EXPIRADO"
  | "SEM_PERMISSAO"
  | "LIMITE_API"
  | "PORTAL_INDISPONIVEL"
  | "RESPOSTA_INVALIDA"
  | "ERRO_INTERNO";

const MENSAGENS: Record<CodigoErro, string> = {
  SEM_CONFIGURACAO:
    "O aplicativo ainda nao foi configurado. Conclua o assistente de configuracao inicial.",
  CREDENCIAIS_INVALIDAS:
    "As credenciais do aplicativo local nao foram aceitas pelo Bitrix24. Confira o ID e a chave secreta no portal.",
  TOKEN_EXPIRADO:
    "A autorizacao com o Bitrix24 expirou e nao pudemos renova-la. Reautorize o aplicativo.",
  SEM_PERMISSAO:
    "Seu usuario no Bitrix24 nao tem permissao para esta acao. Fale com o administrador do portal.",
  LIMITE_API:
    "O Bitrix24 limitou temporariamente as consultas. Aguarde alguns segundos e tente novamente.",
  PORTAL_INDISPONIVEL:
    "Nao conseguimos falar com o seu portal Bitrix24 agora. Verifique a conexao e tente de novo.",
  RESPOSTA_INVALIDA:
    "O Bitrix24 respondeu em um formato inesperado. Registramos o ocorrido para analise.",
  ERRO_INTERNO:
    "Algo deu errado do nosso lado. Registramos o ocorrido; tente novamente em instantes.",
};

export class AppError extends Error {
  readonly codigo: CodigoErro;
  /** Mensagem segura para exibir na interface. */
  readonly mensagemUsuario: string;
  readonly statusHttp: number;
  readonly detalhe?: Record<string, unknown>;

  constructor(
    codigo: CodigoErro,
    opcoes: {
      /** Detalhe tecnico para o log (nunca exibido ao usuario). */
      tecnico?: string;
      statusHttp?: number;
      detalhe?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(opcoes.tecnico ?? MENSAGENS[codigo], { cause: opcoes.cause });
    this.name = "AppError";
    this.codigo = codigo;
    this.mensagemUsuario = MENSAGENS[codigo];
    this.statusHttp = opcoes.statusHttp ?? statusPadrao(codigo);
    this.detalhe = opcoes.detalhe;
  }
}

function statusPadrao(codigo: CodigoErro): number {
  switch (codigo) {
    case "SEM_CONFIGURACAO":
      return 409;
    case "CREDENCIAIS_INVALIDAS":
    case "TOKEN_EXPIRADO":
      return 401;
    case "SEM_PERMISSAO":
      return 403;
    case "LIMITE_API":
      return 429;
    case "PORTAL_INDISPONIVEL":
      return 502;
    default:
      return 500;
  }
}

/** Normaliza qualquer excecao em AppError, sem vazar detalhe tecnico. */
export function comoAppError(erro: unknown): AppError {
  if (erro instanceof AppError) return erro;
  return new AppError("ERRO_INTERNO", {
    tecnico: erro instanceof Error ? erro.message : String(erro),
    cause: erro,
  });
}

/** Corpo JSON padronizado para as rotas de API. */
export function corpoErro(erro: AppError) {
  return {
    ok: false as const,
    erro: { codigo: erro.codigo, mensagem: erro.mensagemUsuario },
  };
}
