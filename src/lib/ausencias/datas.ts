/**
 * Datas de calendario como string ISO "AAAA-MM-DD", sem horario nem fuso.
 *
 * Ferias sao dias inteiros. Usar `Date` local desloca a data conforme o fuso da
 * maquina (e o Bitrix ja desloca pelo fuso de quem chama a API), entao toda
 * aritmetica aqui e feita em UTC e a comparacao e lexicografica.
 */

export type DataISO = string;

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function ehDataISO(valor: string): valor is DataISO {
  const m = FORMATO.exec(valor);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    d.getUTCFullYear() === ano &&
    d.getUTCMonth() === mes - 1 &&
    d.getUTCDate() === dia
  );
}

export function paraDate(data: DataISO): Date {
  if (!ehDataISO(data)) throw new RangeError(`Data invalida: ${data}`);
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

export function deDate(d: Date): DataISO {
  const ano = String(d.getUTCFullYear()).padStart(4, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function somarDias(data: DataISO, dias: number): DataISO {
  const d = paraDate(data);
  d.setUTCDate(d.getUTCDate() + dias);
  return deDate(d);
}

/** 0 = domingo ... 6 = sabado. */
export function diaDaSemana(data: DataISO): number {
  return paraDate(data).getUTCDay();
}

/** Todos os dias do intervalo, inclusive nas duas pontas. Vazio se fim < inicio. */
export function intervaloInclusivo(inicio: DataISO, fim: DataISO): DataISO[] {
  if (!ehDataISO(inicio) || !ehDataISO(fim)) {
    throw new RangeError(`Intervalo invalido: ${inicio}..${fim}`);
  }
  const dias: DataISO[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

export function sobrepoe(
  a: { inicio: DataISO; fim: DataISO },
  b: { inicio: DataISO; fim: DataISO },
): boolean {
  return a.inicio <= b.fim && b.inicio <= a.fim;
}

/** Mesma data de aniversario `anos` depois; 29/02 cai em 28/02 em ano nao bissexto. */
export function somarAnos(data: DataISO, anos: number): DataISO {
  const [ano, mes, dia] = data.split("-").map(Number);
  const alvo = ano + anos;
  const ultimoDia = new Date(Date.UTC(alvo, mes, 0)).getUTCDate();
  return deDate(new Date(Date.UTC(alvo, mes - 1, Math.min(dia, ultimoDia))));
}
