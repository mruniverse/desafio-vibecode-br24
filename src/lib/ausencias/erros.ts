/**
 * Erro de dominio de ausencias.
 *
 * Funcoes puras lancam `ErroDominio` para entrada invalida e transicao
 * proibida. Estende `AppError`, entao `rota()` ja o converte em 422/409/403/404
 * sem cair em ERRO_INTERNO. Resultado de negocio ESPERADO (ex.: "sem saldo")
 * pode ser devolvido como valor; entrada invalida sempre lanca.
 *
 * Sem propriedade de parametro no construtor: o runner do Node (strip-types)
 * nao a suporta.
 */
import { AppError, type CodigoErro } from "@/lib/errors";

export type SubcodigoDominio =
  | "DATA_INVALIDA"
  | "INTERVALO_INVALIDO"
  | "INTERVALO_LONGO"
  | "NUMERO_INVALIDO"
  | "SOBREPOSICAO"
  | "SALDO_INSUFICIENTE"
  | "JUSTIFICATIVA_OBRIGATORIA"
  | "TRANSICAO_INVALIDA"
  | "SEM_PERMISSAO"
  | "NAO_ENCONTRADO"
  | "TIPO_SENSIVEL";

export class ErroDominio extends AppError {
  readonly subcodigo: SubcodigoDominio;

  constructor(subcodigo: SubcodigoDominio, tecnico: string) {
    super(codigoBase(subcodigo), { tecnico });
    this.name = "ErroDominio";
    this.subcodigo = subcodigo;
  }
}

function codigoBase(sub: SubcodigoDominio): CodigoErro {
  switch (sub) {
    case "SALDO_INSUFICIENTE":
      return "SALDO_INSUFICIENTE";
    case "TRANSICAO_INVALIDA":
    case "SOBREPOSICAO":
      return "TRANSICAO_INVALIDA";
    case "SEM_PERMISSAO":
      return "SEM_PERMISSAO";
    case "NAO_ENCONTRADO":
      return "NAO_ENCONTRADO";
    default:
      return "VALIDACAO";
  }
}

/** Intervalo maximo aceito em qualquer funcao que percorra dias. */
export const MAX_DIAS_INTERVALO = 366;
