/**
 * Formatação de datas e rótulos em português. Datas são strings ISO "AAAA-MM-DD";
 * toda conta usa UTC para não deslocar o dia pelo fuso do navegador.
 */
import type { StatusPedido } from "@/lib/ausencias/tipos";
import type { BadgeTom } from "@/components/ui";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const MS_DIA = 86_400_000;

function ms(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}

export function somarDias(d: string, n: number): string {
  return new Date(ms(d) + n * MS_DIA).toISOString().slice(0, 10);
}

export function diaDaSemana(d: string): number {
  return new Date(ms(d)).getUTCDay();
}

export function nomeDiaSemana(d: string, curto = false): string {
  return (curto ? DIAS_CURTOS : DIAS)[diaDaSemana(d)];
}

export function nomeMes(mes: number): string {
  return MESES[mes - 1] ?? "";
}

/** "2026-11-16" -> "16/11". */
export function dataCurta(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** "2026-11-16" -> "16/11/2026". */
export function dataCompleta(d: string): string {
  return `${dataCurta(d)}/${d.slice(0, 4)}`;
}

/** "segunda, 16/11/2026". */
export function dataComSemana(d: string): string {
  return `${nomeDiaSemana(d)}, ${dataCompleta(d)}`;
}

/** "16/11 a 27/11/2026" (ou só um dia). */
export function periodo(inicio: string, fim: string): string {
  if (inicio === fim) return dataCompleta(inicio);
  const mesmoAno = inicio.slice(0, 4) === fim.slice(0, 4);
  return `${mesmoAno ? dataCurta(inicio) : dataCompleta(inicio)} a ${dataCompleta(fim)}`;
}

/** "novembro de 2026" a partir de "2026-11". */
export function mesPorExtenso(anoMes: string): string {
  return `${nomeMes(Number(anoMes.slice(5, 7)))} de ${anoMes.slice(0, 4)}`;
}

export function primeiroDiaDoMes(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

export function ultimoDiaDoMes(d: string): string {
  const [a, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export function somarMeses(d: string, n: number): string {
  const [a, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** Hora local do instante ISO ("às 9h" simplificado como HH:MM em UTC é impreciso; usamos a data). */
export function dataDoInstante(i: string): string {
  return i.slice(0, 10);
}

export function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

export function primeiroNome(nome: string): string {
  return nome.split(" ")[0] ?? nome;
}

export function iniciais(nome: string): string {
  const partes = nome.split(" ").filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

export const ROTULO_PAPEL: Record<string, string> = { colaborador: "Colaborador", gestor: "Gestor", admin: "Administrador" };

/** Rótulo e tom do status. "Concluído" = aprovado cujo período já terminou. */
export function statusDoPedido(status: StatusPedido, fim: string, hoje: string): { rotulo: string; tom: BadgeTom } {
  if (status === "pendente") return { rotulo: "Em análise", tom: "alerta" };
  if (status === "aprovada") return fim < hoje ? { rotulo: "Concluído", tom: "neutro" } : { rotulo: "Aprovado", tom: "sucesso" };
  if (status === "recusada") return { rotulo: "Recusado", tom: "perigo" };
  return { rotulo: "Cancelado", tom: "neutro" };
}

/** Taxa pode vir como fração (0–1) ou percentual (0–100): normaliza para texto "75%". */
export function porcentagem(valor: number | null): string {
  if (valor === null) return "—";
  const pct = valor <= 1 ? valor * 100 : valor;
  return `${Math.round(pct)}%`;
}

export function horasLegiveis(h: number | null): string {
  if (h === null) return "—";
  if (h < 24) return `${Math.round(h)} h`;
  return `${Math.round((h / 24) * 10) / 10} dias`;
}
