/**
 * Dias uteis a partir do calendario de trabalho do portal (`CalendarioTrabalho`,
 * convertido pelo C3 a partir de `calendar.settings.get`).
 *
 * O app nao inventa feriado: o que nao estiver configurado no portal nao e
 * feriado, e isso e devolvido como aviso para o RH (ver `avisosDeConfiguracao`).
 * Feriado fixo vem como `MM-DD` (recorrente) e feriado do ano como `AAAA-MM-DD`.
 * Feriado movel (Carnaval, Pascoa, Corpus Christi) so existe se o cliente cadastrou.
 *
 * Calendario ausente (`null`) = sabado e domingo nao uteis, sem feriado.
 * Entrada malformada lanca `ErroDominio` (DATA_INVALIDA): descartar em silencio um
 * feriado erraria a contagem de dias uteis e, por consequencia, o saldo.
 */
import { diaDaSemana, ehDataISO, intervaloInclusivo, validarData, type DataISO } from "./datas";
import { ErroDominio } from "./erros";
import type { CalendarioTrabalho } from "./tipos";

const SIGLA_PARA_DIA: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const PADRAO_NAO_UTEIS = ["SA", "SU"];

export interface CalendarioUtil {
  /** Feriados fixos "MM-DD", recorrentes todo ano. */
  feriadosAnuais: ReadonlySet<string>;
  /** Feriados de um ano especifico "AAAA-MM-DD". */
  feriadosDoAno: ReadonlySet<DataISO>;
  /** 0 = domingo ... 6 = sabado. */
  diasDeFolgaSemanal: ReadonlySet<number>;
  /** Dias normalmente de folga que sao trabalhados (vencem feriado e fim de semana). */
  excecoesTrabalhadas: ReadonlySet<DataISO>;
}

function exigirLista(valor: unknown, campo: string): unknown[] {
  if (!Array.isArray(valor)) {
    throw new ErroDominio("DATA_INVALIDA", `${campo} deve ser uma lista`);
  }
  return valor;
}

/** `MM-DD` valido (29/02 aceito) ou data completa. Devolve a classe do feriado. */
function lerFeriado(bruto: unknown): { tipo: "anual" | "ano"; valor: string } {
  if (typeof bruto === "string") {
    if (/^\d{2}-\d{2}$/.test(bruto) && ehDataISO(`2000-${bruto}`)) return { tipo: "anual", valor: bruto };
    if (ehDataISO(bruto)) return { tipo: "ano", valor: bruto };
  }
  throw new ErroDominio("DATA_INVALIDA", "feriado deve ser MM-DD ou AAAA-MM-DD validos");
}

export function calendarioDoPortal(c: CalendarioTrabalho | null): CalendarioUtil {
  const semana = new Set<number>();
  const anuais = new Set<string>();
  const doAno = new Set<DataISO>();
  const excecoes = new Set<DataISO>();

  const siglas =
    c === null || c === undefined || c.diasNaoUteis === undefined
      ? PADRAO_NAO_UTEIS
      : exigirLista(c.diasNaoUteis, "diasNaoUteis");
  for (const sigla of siglas) {
    const dia = typeof sigla === "string" ? SIGLA_PARA_DIA[sigla.trim().toUpperCase()] : undefined;
    if (dia === undefined) throw new ErroDominio("DATA_INVALIDA", "dia da semana nao util desconhecido");
    semana.add(dia);
  }

  if (c !== null && c !== undefined) {
    for (const bruto of exigirLista(c.feriados ?? [], "feriados")) {
      const f = lerFeriado(bruto);
      (f.tipo === "anual" ? anuais : doAno).add(f.valor);
    }
    for (const bruto of exigirLista(c.excecoesTrabalhadas ?? [], "excecoesTrabalhadas")) {
      excecoes.add(validarData(bruto, "excecao trabalhada"));
    }
  }

  return {
    feriadosAnuais: anuais,
    feriadosDoAno: doAno,
    diasDeFolgaSemanal: semana,
    excecoesTrabalhadas: excecoes,
  };
}

function exigirCalendario(cal: CalendarioUtil): CalendarioUtil {
  if (
    cal === null ||
    typeof cal !== "object" ||
    !(cal.feriadosAnuais instanceof Set) ||
    !(cal.feriadosDoAno instanceof Set) ||
    !(cal.diasDeFolgaSemanal instanceof Set) ||
    !(cal.excecoesTrabalhadas instanceof Set)
  ) {
    throw new ErroDominio("DATA_INVALIDA", "calendario invalido: use calendarioDoPortal()");
  }
  return cal;
}

/** Feriado cadastrado no portal naquele dia (excecao trabalhada anula o feriado). */
export function ehFeriado(data: DataISO, cal: CalendarioUtil): boolean {
  exigirCalendario(cal);
  const d = validarData(data);
  if (cal.excecoesTrabalhadas.has(d)) return false;
  return cal.feriadosDoAno.has(d) || cal.feriadosAnuais.has(d.slice(5));
}

export function ehDiaUtil(data: DataISO, cal: CalendarioUtil): boolean {
  exigirCalendario(cal);
  const d = validarData(data);
  if (cal.excecoesTrabalhadas.has(d)) return true;
  if (ehFeriado(d, cal)) return false;
  return !cal.diasDeFolgaSemanal.has(diaDaSemana(d));
}

/** Dias uteis do intervalo, inclusivo nas duas pontas (maximo MAX_DIAS_INTERVALO dias). */
export function diasUteisEntre(inicio: DataISO, fim: DataISO, cal: CalendarioUtil): DataISO[] {
  return intervaloInclusivo(inicio, fim).filter((d) => ehDiaUtil(d, cal));
}

export function contarDiasUteis(inicio: DataISO, fim: DataISO, cal: CalendarioUtil): number {
  return diasUteisEntre(inicio, fim, cal).length;
}

/**
 * Avisos para o RH quando o calendario do portal parece incompleto. Nao
 * corrige nada: so impede que "sem feriado cadastrado" passe por "sem feriado".
 */
export function avisosDeConfiguracao(cal: CalendarioUtil): string[] {
  exigirCalendario(cal);
  const avisos: string[] = [];
  if (cal.feriadosAnuais.size + cal.feriadosDoAno.size === 0) {
    avisos.push("O portal nao tem feriados cadastrados: todo dia de semana sera contado como util.");
  }
  if (cal.diasDeFolgaSemanal.size === 0) {
    avisos.push("O portal nao define dias de folga semanal: sabados e domingos serao contados como uteis.");
  }
  return avisos;
}
