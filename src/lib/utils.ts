/** Junta classes condicionalmente, sem dependencia externa. */
export function cn(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(" ");
}

/** Formata data/hora no padrao brasileiro. */
export function dataHoraBr(valor: Date | string | number): string {
  const d = valor instanceof Date ? valor : new Date(valor);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "agora", "ha 3 min", "ha 2 h" — para indicar frescor do cache na UI. */
export function tempoRelativo(valor: Date | string | number): string {
  const d = valor instanceof Date ? valor : new Date(valor);
  const segundos = Math.floor((Date.now() - d.getTime()) / 1000);
  if (segundos < 45) return "agora";
  if (segundos < 3600) return `ha ${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `ha ${Math.floor(segundos / 3600)} h`;
  return dataHoraBr(d);
}

export function moedaBr(valor: number, moeda = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: moeda,
  }).format(valor);
}

export function numeroBr(valor: number): string {
  return new Intl.NumberFormat("pt-BR").format(valor);
}
