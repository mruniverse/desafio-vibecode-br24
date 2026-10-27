/**
 * Cobertura da equipe (BR24-005 v2.2, itens 1 e 13).
 *
 * Pessoas trabalhando num dia = membros da equipe (todo `Pessoa` com
 * `equipeId`, gestor incluso) menos os ausentes naquele dia. Conta como ausente:
 *   - pedido `aprovada` em [inicio, fim] (mesmo com sincronizacao em falha:
 *     o app e a fonte);
 *   - pedido `pendente`, SO se `equipe.contarPendentes`;
 *   - pedido `cancelada` apenas ANTES de `canceladoEm` (e, se nunca foi
 *     aprovado, so com `contarPendentes`, como o pendente que foi).
 * `recusada` nunca conta. A mesma pessoa com dois pedidos no dia conta uma vez.
 *
 * Dia nao util nao conta: nunca esta "abaixo do minimo" nem entra no pior dia.
 * "Abaixo do minimo" = trabalhando < `equipe.minimoPessoas`.
 * Semana = segunda a domingo. `pedido` hipotetico soma UM ausente (o solicitante).
 */
import { intervaloInclusivo, inicioDaSemana, sobrepoe, validarIntervalo, type DataISO } from "./datas";
import { ehDiaUtil, ehFeriado, type CalendarioUtil } from "./dias-uteis";
import { ErroDominio } from "./erros";
import { intervaloVigente } from "./estados";
import type { Equipe, Pedido, Pessoa } from "./tipos";

/** Campos do pedido que a cobertura le. `Pedido` satisfaz. */
export type PedidoCobertura = Pick<Pedido, "pessoaId" | "inicio" | "fim" | "status" | "sincronizacao" | "canceladoEm">;

export interface EntradaCobertura {
  equipe: Equipe;
  /** Pode conter pessoas de outras equipes: so as de `equipe.id` entram. */
  pessoas: readonly Pessoa[];
  pedidos: readonly PedidoCobertura[];
  cal: CalendarioUtil;
  de: DataISO;
  ate: DataISO;
}

export interface DiaCobertura {
  data: DataISO;
  util: boolean;
  feriado: boolean;
  /** Membros da equipe. */
  total: number;
  ausentes: number;
  trabalhando: number;
  /** So dia util pode estar abaixo do minimo. */
  abaixoDoMinimo: boolean;
}

/** Ausente hipotetico (o solicitante) para "com pedido". */
export interface PedidoHipotetico {
  pessoaId: string;
  inicio: DataISO;
  fim: DataISO;
}

export interface PiorDia {
  data: DataISO;
  trabalhando: number;
}

export interface SemanaPior {
  /** Segunda-feira. */
  semanaInicio: DataISO;
  /** Menor numero de pessoas trabalhando na semana (dias uteis do intervalo). */
  semPedido: number;
  comPedido: number;
  diaSemPedido: DataISO;
  diaComPedido: DataISO;
}

function validarEquipe(equipe: Equipe): void {
  if (!Number.isInteger(equipe?.minimoPessoas) || equipe.minimoPessoas < 1) {
    throw new ErroDominio("NUMERO_INVALIDO", "minimoPessoas deve ser inteiro >= 1");
  }
  if (typeof equipe.contarPendentes !== "boolean") {
    throw new ErroDominio("NUMERO_INVALIDO", "contarPendentes deve ser booleano");
  }
}

/** Membros da equipe: todo `Pessoa` com `equipeId`, gestor incluso. */
export function membrosDaEquipe(equipe: Equipe, pessoas: readonly Pessoa[]): Pessoa[] {
  if (typeof equipe?.id !== "string" || !Array.isArray(pessoas)) {
    throw new ErroDominio("NAO_ENCONTRADO", "equipe ou lista de pessoas invalida");
  }
  return pessoas.filter((p) => p.equipeId === equipe.id);
}

/**
 * Intervalo em que o pedido conta como ausencia na cobertura, ou `null`.
 * Respeita `contarPendentes` e `canceladoEm`.
 */
export function intervaloQueConta(
  p: PedidoCobertura,
  contarPendentes: boolean,
): { inicio: DataISO; fim: DataISO } | null {
  if (typeof contarPendentes !== "boolean") {
    throw new ErroDominio("NUMERO_INVALIDO", "contarPendentes deve ser booleano");
  }
  if (p.status === "pendente" && !contarPendentes) return null;
  if (p.status === "cancelada" && p.sincronizacao === "nao_aplicavel" && !contarPendentes) return null;
  return intervaloVigente(p);
}

function calcularDias(entrada: EntradaCobertura, hipotetico?: PedidoHipotetico): DiaCobertura[] {
  validarEquipe(entrada.equipe);
  const dias = intervaloInclusivo(entrada.de, entrada.ate);
  const membros = new Set(membrosDaEquipe(entrada.equipe, entrada.pessoas).map((m) => m.id));

  const faixas: { pessoaId: string; inicio: DataISO; fim: DataISO }[] = [];
  for (const p of entrada.pedidos) {
    if (!membros.has(p.pessoaId)) continue;
    const f = intervaloQueConta(p, entrada.equipe.contarPendentes);
    if (f !== null) faixas.push({ pessoaId: p.pessoaId, ...f });
  }
  if (hipotetico !== undefined) {
    if (!membros.has(hipotetico.pessoaId)) {
      throw new ErroDominio("NAO_ENCONTRADO", "solicitante nao pertence a equipe");
    }
    faixas.push({ pessoaId: hipotetico.pessoaId, ...validarIntervalo(hipotetico.inicio, hipotetico.fim) });
  }

  return dias.map((data) => {
    const ausentes = new Set<string>();
    for (const f of faixas) if (f.inicio <= data && data <= f.fim) ausentes.add(f.pessoaId);
    const util = ehDiaUtil(data, entrada.cal);
    const trabalhando = membros.size - ausentes.size;
    return {
      data,
      util,
      feriado: ehFeriado(data, entrada.cal),
      total: membros.size,
      ausentes: ausentes.size,
      trabalhando,
      abaixoDoMinimo: util && trabalhando < entrada.equipe.minimoPessoas,
    };
  });
}

/** Uma linha por dia de [de, ate] (maximo 366 dias): quem trabalha e se esta abaixo do minimo. */
export function pessoasTrabalhandoPorDia(entrada: EntradaCobertura): DiaCobertura[] {
  return calcularDias(entrada);
}

/** Quantos dias uteis ficaram abaixo do minimo. */
export function contarDiasAbaixoDoMinimo(dias: readonly DiaCobertura[]): number {
  if (!Array.isArray(dias)) throw new ErroDominio("NUMERO_INVALIDO", "dias deve ser uma lista");
  return dias.filter((d) => d.abaixoDoMinimo).length;
}

/** Dia util com menos gente trabalhando (o primeiro em caso de empate); `null` se nao ha dia util. */
export function piorDia(dias: readonly DiaCobertura[]): PiorDia | null {
  if (!Array.isArray(dias)) throw new ErroDominio("NUMERO_INVALIDO", "dias deve ser uma lista");
  let pior: PiorDia | null = null;
  for (const d of dias) {
    if (d.util && (pior === null || d.trabalhando < pior.trabalhando)) pior = { data: d.data, trabalhando: d.trabalhando };
  }
  return pior;
}

/**
 * Pior dia de cada semana (seg-dom, so dias uteis dentro de [de, ate]), sem e com
 * o pedido hipotetico. Sem `pedido`, `comPedido = semPedido`. Se o pedido ja esta
 * em `pedidos` e conta (aprovado, ou pendente com `contarPendentes`), exclua-o da
 * lista para a coluna "sem pedido" (a mesma pessoa nunca conta duas vezes).
 */
export function piorDiaPorSemana(entrada: EntradaCobertura, pedido?: PedidoHipotetico): SemanaPior[] {
  const sem = calcularDias(entrada);
  const com = pedido === undefined ? sem : calcularDias(entrada, pedido);
  const semanas = new Map<DataISO, { sem: DiaCobertura; com: DiaCobertura }>();
  const ordem: DataISO[] = [];
  sem.forEach((d, i) => {
    if (!d.util) return;
    const chave = inicioDaSemana(d.data);
    const atual = semanas.get(chave);
    if (atual === undefined) {
      ordem.push(chave);
      semanas.set(chave, { sem: d, com: com[i] });
      return;
    }
    if (d.trabalhando < atual.sem.trabalhando) atual.sem = d;
    if (com[i].trabalhando < atual.com.trabalhando) atual.com = com[i];
  });
  return ordem.map((semanaInicio) => {
    const s = semanas.get(semanaInicio) as { sem: DiaCobertura; com: DiaCobertura };
    return {
      semanaInicio,
      semPedido: s.sem.trabalhando,
      comPedido: s.com.trabalhando,
      diaSemPedido: s.sem.data,
      diaComPedido: s.com.data,
    };
  });
}

/**
 * O pedido hipotetico deixaria algum dia util do proprio periodo abaixo do minimo?
 * E so informacao: conflito de equipe NUNCA bloqueia o pedido.
 */
export function haConflitoDeEquipe(
  entrada: Omit<EntradaCobertura, "de" | "ate">,
  pedido: PedidoHipotetico,
): boolean {
  const { inicio, fim } = validarIntervalo(pedido.inicio, pedido.fim);
  return contarDiasAbaixoDoMinimo(calcularDias({ ...entrada, de: inicio, ate: fim }, pedido)) > 0;
}

/**
 * Sobreposicao do proprio colaborador: pedido `pendente|aprovada` que divide
 * algum DIA UTIL com [inicio, fim] => SOBREPOSICAO. `ignorarPedidoId` serve
 * para revalidar um pedido ja gravado sem colidir consigo mesmo.
 */
export function verificarSobreposicao(entrada: {
  pedidos: readonly (PedidoCobertura & { id: number })[];
  pessoaId: string;
  inicio: DataISO;
  fim: DataISO;
  cal: CalendarioUtil;
  ignorarPedidoId?: number;
}): void {
  const novo = validarIntervalo(entrada.inicio, entrada.fim);
  for (const p of entrada.pedidos) {
    if (p.pessoaId !== entrada.pessoaId || p.id === entrada.ignorarPedidoId) continue;
    if (p.status !== "pendente" && p.status !== "aprovada") continue;
    const outro = validarIntervalo(p.inicio, p.fim);
    if (!sobrepoe(novo, outro)) continue;
    const ini = novo.inicio > outro.inicio ? novo.inicio : outro.inicio;
    const fimComum = novo.fim < outro.fim ? novo.fim : outro.fim;
    if (intervaloInclusivo(ini, fimComum).some((d) => ehDiaUtil(d, entrada.cal))) {
      throw new ErroDominio("SOBREPOSICAO", `periodo ja coberto pelo pedido ${p.id}`);
    }
  }
}
