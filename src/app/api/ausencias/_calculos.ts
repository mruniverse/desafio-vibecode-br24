/**
 * Aritmetica de datas do provedor de demonstracao. Tudo em UTC, ISO "AAAA-MM-DD",
 * intervalo inclusivo. Sem `Date.now()`: quem chama passa `hoje`.
 * Sem enum/namespace/propriedade de parametro (strip-types).
 */
import type { DataISO } from "@/lib/ausencias/tipos";
import { FERIADOS_FIXOS } from "./_fixtures";

const MS_DIA = 86_400_000;
const LIMITE_DIAS = 800;

export function paraMs(d: DataISO): number {
  return Date.parse(`${d}T00:00:00Z`);
}

export function deMs(ms: number): DataISO {
  return new Date(ms).toISOString().slice(0, 10);
}

export function somarDias(d: DataISO, n: number): DataISO {
  return deMs(paraMs(d) + n * MS_DIA);
}

export function diferencaDias(a: DataISO, b: DataISO): number {
  return Math.round((paraMs(b) - paraMs(a)) / MS_DIA);
}

/** 0 = domingo ... 6 = sabado. */
export function diaSemana(d: DataISO): number {
  return new Date(paraMs(d)).getUTCDay();
}

export function ehFeriado(d: DataISO): boolean {
  return FERIADOS_FIXOS.includes(d.slice(5));
}

export function ehUtil(d: DataISO): boolean {
  const s = diaSemana(d);
  return s !== 0 && s !== 6 && !ehFeriado(d);
}

export function intervalo(inicio: DataISO, fim: DataISO): DataISO[] {
  const total = diferencaDias(inicio, fim) + 1;
  if (!Number.isFinite(total) || total <= 0) return [];
  const n = Math.min(total, LIMITE_DIAS);
  const saida: DataISO[] = [];
  for (let i = 0; i < n; i++) saida.push(somarDias(inicio, i));
  return saida;
}

export function diasUteisEntre(inicio: DataISO, fim: DataISO): DataISO[] {
  return intervalo(inicio, fim).filter(ehUtil);
}

export function segundaDaSemana(d: DataISO): DataISO {
  const s = diaSemana(d);
  return somarDias(d, s === 0 ? -6 : 1 - s);
}

export function sobrepoe(a: { inicio: DataISO; fim: DataISO }, b: { inicio: DataISO; fim: DataISO }): boolean {
  return a.inicio <= b.fim && b.inicio <= a.fim;
}

/** "2026-11-16" -> "16/11". */
export function curto(d: DataISO): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

export function periodoCurto(inicio: DataISO, fim: DataISO): string {
  return inicio === fim ? curto(inicio) : `${curto(inicio)} a ${curto(fim)}`;
}

export function debitoPorAno(dias: DataISO[]): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const d of dias) {
    const ano = d.slice(0, 4);
    saida[ano] = (saida[ano] ?? 0) + 1;
  }
  return saida;
}
