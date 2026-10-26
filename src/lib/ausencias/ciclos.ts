/**
 * Ciclos anuais de ferias ancorados na data de admissao.
 *
 * Politica de demonstracao (BR24-002): ciclo de 12 meses a partir da admissao.
 * Sem data de admissao NAO se calcula saldo — o RH precisa configurar. Nada aqui
 * tem pretensao de calculo legal/trabalhista.
 */
import { somarAnos, somarDias, type DataISO } from "./datas";

export interface Ciclo {
  /** Primeiro dia do ciclo (inclusivo). */
  inicio: DataISO;
  /** Ultimo dia do ciclo (inclusivo). */
  fim: DataISO;
  /** 0 = primeiro ano de casa. */
  indice: number;
}

export type ResultadoCiclo =
  | { ok: true; ciclo: Ciclo }
  | { ok: false; motivo: "sem_admissao" | "antes_da_admissao" };

export function cicloDaData(
  data: DataISO,
  admissao: DataISO | null | undefined,
): ResultadoCiclo {
  if (!admissao) return { ok: false, motivo: "sem_admissao" };
  if (data < admissao) return { ok: false, motivo: "antes_da_admissao" };
  let indice = 0;
  while (somarAnos(admissao, indice + 1) <= data) indice += 1;
  return {
    ok: true,
    ciclo: {
      indice,
      inicio: somarAnos(admissao, indice),
      fim: somarDias(somarAnos(admissao, indice + 1), -1),
    },
  };
}

export interface ParcelaDeCiclo {
  ciclo: Ciclo;
  inicio: DataISO;
  fim: DataISO;
}

export type ResultadoDivisao =
  | { ok: true; parcelas: ParcelaDeCiclo[] }
  | { ok: false; motivo: "sem_admissao" | "antes_da_admissao" | "intervalo_invalido" };

/** Divide um periodo em uma parcela por ciclo, para mostrar cada uma separada. */
export function dividirPorCiclo(
  inicio: DataISO,
  fim: DataISO,
  admissao: DataISO | null | undefined,
): ResultadoDivisao {
  if (fim < inicio) return { ok: false, motivo: "intervalo_invalido" };
  const primeiro = cicloDaData(inicio, admissao);
  if (!primeiro.ok) return primeiro;

  const parcelas: ParcelaDeCiclo[] = [];
  let cursor = inicio;
  let ciclo = primeiro.ciclo;
  while (cursor <= fim) {
    const fimParcela = ciclo.fim < fim ? ciclo.fim : fim;
    parcelas.push({ ciclo, inicio: cursor, fim: fimParcela });
    cursor = somarDias(fimParcela, 1);
    if (cursor <= fim) {
      const proximo = cicloDaData(cursor, admissao);
      if (!proximo.ok) return proximo;
      ciclo = proximo.ciclo;
    }
  }
  return { ok: true, parcelas };
}
