/**
 * Dias uteis a partir da configuracao REAL do portal (`calendar.settings.get`).
 *
 * O app nao inventa feriado: o que nao estiver configurado no portal nao e
 * feriado, e isso e devolvido como aviso para o RH (ver `avisosDeConfiguracao`).
 * `year_holidays` e recorrente anual ("dia.mes", sem ano). Feriado movel
 * (Carnaval, Pascoa, Corpus Christi) so existe se o cliente cadastrou.
 */
import {
  diaDaSemana,
  intervaloInclusivo,
  paraDate,
  type DataISO,
} from "./datas";

const SIGLA_PARA_DIA: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** Formato de `calendar.settings.get`, so os campos que o dominio usa. */
export interface ConfiguracaoCalendarioBitrix {
  year_holidays?: string | null;
  week_holidays?: string[] | null;
  year_workdays?: string | null;
}

export interface CalendarioUtil {
  /** Chaves "D.M" sem zero a esquerda, recorrentes todo ano. */
  feriadosAnuais: ReadonlySet<string>;
  /** 0 = domingo ... 6 = sabado. */
  diasDeFolgaSemanal: ReadonlySet<number>;
  /** Dias normalmente de folga que sao trabalhados (vencem feriado e fim de semana). */
  excecoesTrabalhadas: ReadonlySet<string>;
}

/** "01.05" e "1.5" viram "1.5". Entrada invalida e descartada. */
function normalizarChave(bruto: string): string | null {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\s*$/.exec(bruto);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return `${dia}.${mes}`;
}

function lerLista(valor: string | null | undefined): Set<string> {
  const saida = new Set<string>();
  if (!valor) return saida;
  for (const parte of valor.split(",")) {
    const chave = normalizarChave(parte);
    if (chave) saida.add(chave);
  }
  return saida;
}

export function calendarioDoPortal(
  config: ConfiguracaoCalendarioBitrix | null | undefined,
): CalendarioUtil {
  const semana = new Set<number>();
  for (const sigla of config?.week_holidays ?? []) {
    const dia = SIGLA_PARA_DIA[String(sigla).toUpperCase()];
    if (dia !== undefined) semana.add(dia);
  }
  return {
    feriadosAnuais: lerLista(config?.year_holidays),
    diasDeFolgaSemanal: semana,
    excecoesTrabalhadas: lerLista(config?.year_workdays),
  };
}

function chaveDiaMes(data: DataISO): string {
  const d = paraDate(data);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

export function ehDiaUtil(data: DataISO, cal: CalendarioUtil): boolean {
  const chave = chaveDiaMes(data);
  if (cal.excecoesTrabalhadas.has(chave)) return true;
  if (cal.feriadosAnuais.has(chave)) return false;
  return !cal.diasDeFolgaSemanal.has(diaDaSemana(data));
}

/** Dias uteis do intervalo, inclusivo nas duas pontas. */
export function diasUteisEntre(
  inicio: DataISO,
  fim: DataISO,
  cal: CalendarioUtil,
): DataISO[] {
  return intervaloInclusivo(inicio, fim).filter((d) => ehDiaUtil(d, cal));
}

export function contarDiasUteis(
  inicio: DataISO,
  fim: DataISO,
  cal: CalendarioUtil,
): number {
  return diasUteisEntre(inicio, fim, cal).length;
}

/**
 * Avisos para o RH quando o calendario do portal parece incompleto. Nao
 * corrige nada: so impede que "sem feriado cadastrado" passe por "sem feriado".
 */
export function avisosDeConfiguracao(cal: CalendarioUtil): string[] {
  const avisos: string[] = [];
  if (cal.feriadosAnuais.size === 0) {
    avisos.push(
      "O portal nao tem feriados cadastrados: todo dia de semana sera contado como util.",
    );
  }
  if (cal.diasDeFolgaSemanal.size === 0) {
    avisos.push(
      "O portal nao define dias de folga semanal: sabados e domingos serao contados como uteis.",
    );
  }
  return avisos;
}
