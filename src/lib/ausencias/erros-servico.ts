/**
 * Erros dos servicos de ausencias com MENSAGEM PROPRIA em portugues (a de
 * `AppError` e fixa por codigo). Estendem `AppError`: o `rota()` converte em
 * HTTP sem cair em ERRO_INTERNO. Nunca ponha motivo/justificativa na mensagem.
 *
 * Sem propriedade de parametro no construtor (strip-types dos testes).
 */
import { z } from "zod";
import { AppError, type CodigoErro } from "@/lib/errors";

export class ErroServico extends AppError {
  /** Dados NAO sensiveis que a tela precisa para reagir (ex.: assinatura do recalculo). */
  readonly extras?: Record<string, string>;

  constructor(codigo: CodigoErro, statusHttp: number, mensagem: string, extras?: Record<string, string>) {
    super(codigo, { statusHttp, tecnico: mensagem });
    Object.defineProperty(this, "mensagemUsuario", { value: mensagem, enumerable: true });
    this.extras = extras;
  }
}

/** 404: nao existe OU nao e do escopo de quem pede (nao entrega pista). */
export function negadoComoInexistente(): ErroServico {
  return new ErroServico("NAO_ENCONTRADO", 404, "Não encontramos o que você procura.");
}

export function semPermissao(mensagem = "Você não tem permissão para esta ação."): ErroServico {
  return new ErroServico("SEM_PERMISSAO", 403, mensagem);
}

export function conflito(mensagem: string, extras?: Record<string, string>): ErroServico {
  return new ErroServico("TRANSICAO_INVALIDA", 409, mensagem, extras);
}

/** 422 apontando o campo: o `rota()` devolve `campos` para a tela destacar o input. */
export function erroCampo(campo: string, mensagem: string): z.ZodError {
  return new z.ZodError([{ code: "custom", path: [campo], message: mensagem, input: undefined }]);
}
