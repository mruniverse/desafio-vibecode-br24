/**
 * Erros das rotas de ausencias. Estendem AppError para o `rota()` converter em
 * HTTP sem cair em ERRO_INTERNO, mas com mensagem propria em portugues (a de
 * `AppError` e fixa por codigo). Nunca ponha motivo/justificativa na mensagem.
 */
import { z } from "zod";
import { AppError, type CodigoErro } from "@/lib/errors";

export class ErroAusencias extends AppError {
  constructor(codigo: CodigoErro, statusHttp: number, mensagem: string) {
    super(codigo, { statusHttp, tecnico: mensagem });
    Object.defineProperty(this, "mensagemUsuario", { value: mensagem, enumerable: true });
  }
}

export function naoEncontrado(): ErroAusencias {
  return new ErroAusencias("NAO_ENCONTRADO", 404, "Não encontramos o que você procura.");
}

export function semPermissao(mensagem = "Você não tem permissão para esta ação."): ErroAusencias {
  return new ErroAusencias("SEM_PERMISSAO", 403, mensagem);
}

export function naoAutenticado(mensagem: string): ErroAusencias {
  return new ErroAusencias("SEM_PERMISSAO", 401, mensagem);
}

export function conflito(mensagem: string): ErroAusencias {
  return new ErroAusencias("TRANSICAO_INVALIDA", 409, mensagem);
}

/** 422 apontando o campo: o `rota()` devolve `campos` para a tela destacar o input. */
export function erroCampo(campo: string, mensagem: string): z.ZodError {
  return new z.ZodError([{ code: "custom", path: [campo], message: mensagem, input: undefined }]);
}
