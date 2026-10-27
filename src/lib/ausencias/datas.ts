/**
 * Datas de calendario como string ISO "AAAA-MM-DD", sem horario nem fuso.
 *
 * Ferias sao dias inteiros. Usar `Date` local desloca a data conforme o fuso da
 * maquina (e o Bitrix ja desloca pelo fuso de quem chama a API), entao toda
 * aritmetica aqui e feita em UTC e a comparacao e lexicografica.
 *
 * Contrato (BR24-005 v2.2): TODA funcao publica valida a entrada e lanca
 * `ErroDominio` (nunca `RangeError`, `NaN` nem laco infinito). Intervalos
 * percorridos dia a dia sao limitados a MAX_DIAS_INTERVALO.
 *
 * Dominio puro: sem relogio do sistema; `hoje`/`agora` entram por parametro.
 */
import { ErroDominio, MAX_DIAS_INTERVALO } from "./erros";
import type { DataISO, InstanteISO } from "./tipos";

export type { DataISO, InstanteISO } from "./tipos";

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const FORMATO_INSTANTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const MS_POR_DIA = 86_400_000;
const MS_POR_HORA = 3_600_000;

/** Mostra no maximo 40 caracteres do valor ofensivo na mensagem tecnica. */
function mostrar(valor: unknown): string {
  const texto = typeof valor === "string" ? valor : String(valor);
  return JSON.stringify(texto.length > 40 ? `${texto.slice(0, 40)}...` : texto);
}

function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return mes === 4 || mes === 6 || mes === 9 || mes === 11 ? 30 : 31;
}

/** Data de calendario real, 0000-01-01 a 9999-12-31. Aceita so string. */
export function ehDataISO(valor: unknown): valor is DataISO {
  if (typeof valor !== "string") return false;
  const m = FORMATO_DATA.exec(valor);
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes(ano, mes);
}

/** Devolve a data ou lanca DATA_INVALIDA. `campo` entra na mensagem tecnica. */
export function validarData(valor: unknown, campo = "data"): DataISO {
  if (!ehDataISO(valor)) {
    throw new ErroDominio("DATA_INVALIDA", `${campo} invalida: ${mostrar(valor)}`);
  }
  return valor;
}

/** Valida `inicio <= fim` (inclusivo). Lanca DATA_INVALIDA ou INTERVALO_INVALIDO. */
export function validarIntervalo(inicio: unknown, fim: unknown): { inicio: DataISO; fim: DataISO } {
  const i = validarData(inicio, "inicio");
  const f = validarData(fim, "fim");
  if (f < i) throw new ErroDominio("INTERVALO_INVALIDO", `fim ${f} anterior ao inicio ${i}`);
  return { inicio: i, fim: f };
}

export function paraDate(data: DataISO): Date {
  const valida = validarData(data);
  const d = new Date(0);
  // setUTCFullYear evita o mapeamento de anos 0-99 para 1900-1999 de Date.UTC.
  d.setUTCFullYear(Number(valida.slice(0, 4)), Number(valida.slice(5, 7)) - 1, Number(valida.slice(8, 10)));
  return d;
}

export function deDate(d: Date): DataISO {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new ErroDominio("DATA_INVALIDA", "Date invalido");
  }
  const anoNumero = d.getUTCFullYear();
  if (anoNumero < 0 || anoNumero > 9999) {
    throw new ErroDominio("DATA_INVALIDA", `ano fora de 0000-9999: ${anoNumero}`);
  }
  const ano = String(anoNumero).padStart(4, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function exigirInteiro(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isInteger(valor)) {
    throw new ErroDominio("NUMERO_INVALIDO", `${campo} deve ser inteiro finito: ${mostrar(valor)}`);
  }
  return valor;
}

/** `dias` precisa ser inteiro finito (pode ser negativo). Resultado fora de 0000-9999 lanca. */
export function somarDias(data: DataISO, dias: number): DataISO {
  const n = exigirInteiro(dias, "dias");
  return deDate(new Date(paraDate(data).getTime() + n * MS_POR_DIA));
}

/** Mesma data de aniversario `anos` depois; 29/02 cai em 28/02 em ano nao bissexto. */
export function somarAnos(data: DataISO, anos: number): DataISO {
  const n = exigirInteiro(anos, "anos");
  const valida = validarData(data);
  const alvo = Number(valida.slice(0, 4)) + n;
  if (alvo < 0 || alvo > 9999) {
    throw new ErroDominio("DATA_INVALIDA", `ano fora de 0000-9999: ${alvo}`);
  }
  const mes = Number(valida.slice(5, 7));
  const dia = Math.min(Number(valida.slice(8, 10)), diasNoMes(alvo, mes));
  const d = new Date(0);
  d.setUTCFullYear(alvo, mes - 1, dia);
  return deDate(d);
}

/** 0 = domingo ... 6 = sabado. */
export function diaDaSemana(data: DataISO): number {
  return paraDate(data).getUTCDay();
}

/** Segunda-feira da semana (seg-dom) que contem a data. */
export function inicioDaSemana(data: DataISO): DataISO {
  return somarDias(data, -((diaDaSemana(data) + 6) % 7));
}

/** Ano (4 digitos) de uma data valida. */
export function anoDe(data: DataISO): number {
  return Number(validarData(data).slice(0, 4));
}

/** Quantidade de dias do intervalo, inclusivo nas duas pontas. Lanca se fim < inicio. */
export function diasEntre(inicio: DataISO, fim: DataISO): number {
  const v = validarIntervalo(inicio, fim);
  return Math.round((paraDate(v.fim).getTime() - paraDate(v.inicio).getTime()) / MS_POR_DIA) + 1;
}

/**
 * Todos os dias do intervalo, inclusive nas duas pontas. Lanca DATA_INVALIDA,
 * INTERVALO_INVALIDO (fim < inicio) ou INTERVALO_LONGO (> MAX_DIAS_INTERVALO dias).
 */
export function intervaloInclusivo(inicio: DataISO, fim: DataISO): DataISO[] {
  const total = diasEntre(inicio, fim);
  if (total > MAX_DIAS_INTERVALO) {
    throw new ErroDominio("INTERVALO_LONGO", `intervalo de ${total} dias excede ${MAX_DIAS_INTERVALO}`);
  }
  const base = paraDate(inicio).getTime();
  const dias: DataISO[] = [];
  for (let i = 0; i < total; i++) dias.push(deDate(new Date(base + i * MS_POR_DIA)));
  return dias;
}

export function sobrepoe(
  a: { inicio: DataISO; fim: DataISO },
  b: { inicio: DataISO; fim: DataISO },
): boolean {
  const x = validarIntervalo(a.inicio, a.fim);
  const y = validarIntervalo(b.inicio, b.fim);
  return x.inicio <= y.fim && y.inicio <= x.fim;
}

// ---------------------------------------------------------------- instantes

/** Instante UTC `AAAA-MM-DDTHH:MM:SS(.sss)Z`. */
export function ehInstanteISO(valor: unknown): valor is InstanteISO {
  if (typeof valor !== "string") return false;
  const m = FORMATO_INSTANTE.exec(valor);
  if (!m) return false;
  return ehDataISO(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60;
}

export function validarInstante(valor: unknown, campo = "instante"): InstanteISO {
  if (!ehInstanteISO(valor)) {
    throw new ErroDominio("DATA_INVALIDA", `${campo} invalido: ${mostrar(valor)}`);
  }
  return valor;
}

/** Milissegundos desde 1970-01-01T00:00Z (aritmetica exata, sem Date.parse). */
export function instanteParaMs(instante: InstanteISO): number {
  const valido = validarInstante(instante);
  const m = FORMATO_INSTANTE.exec(valido) as RegExpExecArray;
  const milis = m[5] === undefined ? 0 : Number(m[5].padEnd(3, "0"));
  return (
    paraDate(m[1]).getTime() + Number(m[2]) * MS_POR_HORA + Number(m[3]) * 60_000 + Number(m[4]) * 1000 + milis
  );
}

/** Negativo se a < b, 0 se iguais, positivo se a > b. */
export function compararInstantes(a: InstanteISO, b: InstanteISO): number {
  return instanteParaMs(a) - instanteParaMs(b);
}

/** `horas` inteiro finito (pode ser negativo). Devolve `AAAA-MM-DDTHH:MM:SS.sssZ`. */
export function somarHoras(instante: InstanteISO, horas: number): InstanteISO {
  const n = exigirInteiro(horas, "horas");
  const d = new Date(instanteParaMs(instante) + n * MS_POR_HORA);
  const dia = deDate(d);
  const p = (v: number, t: number) => String(v).padStart(t, "0");
  return `${dia}T${p(d.getUTCHours(), 2)}:${p(d.getUTCMinutes(), 2)}:${p(d.getUTCSeconds(), 2)}.${p(d.getUTCMilliseconds(), 3)}Z`;
}

/** Horas (fracionarias) de `de` ate `ate`. Negativo se `ate` for anterior. */
export function horasEntre(de: InstanteISO, ate: InstanteISO): number {
  return (instanteParaMs(ate) - instanteParaMs(de)) / MS_POR_HORA;
}
