/**
 * Saldo de dias (BR24-005 v2.2, item 2). Unidade: dias uteis.
 *
 *   Saldo(pessoa, carteira, hoje) = creditos e ajustes - debitos derivados
 *
 * O debito NAO e persistido: sai dos pedidos `pendente|aprovada` (pendente
 * RESERVA saldo) cujo tipo consome a carteira. Cada dia de debito consome o
 * credito de MENOR `venceEm` com `venceEm >= dia de uso` (FIFO), do mesmo `ano`
 * de competencia; credito sem vencimento e o ultimo a ser consumido. Credito
 * vencido simplesmente deixa de contar em `hoje` (nao ha expiracao automatica):
 * a fronteira `venceEm = dia` ainda vale.
 *
 * Quantidade de dias de cada pedido = `diasDebitoPorAno` (congelado na criacao;
 * pedido que cruza o ano divide o debito). O calendario so informa EM QUE DIA
 * cada dia de debito cai, para testar o vencimento.
 *
 * Pedido `cancelada` ainda debita os dias uteis ANTES de `canceladoEm`
 * ([inicio, min(fim, canceladoEm-1)]), nunca mais que o congelado; `recusada` nao debita.
 *
 * Excedente sao dias sem credito que os cubra; a simulacao sinaliza esse
 * excedente mesmo quando creditos de outros anos deixam o saldo agregado positivo.
 */
import { somarDias, validarData, type DataISO } from "./datas";
import { diasUteisEntre, type CalendarioUtil } from "./dias-uteis";
import { ErroDominio } from "./erros";
import { intervaloVigente } from "./estados";
import type { Carteira, Lancamento, Pedido, Tipo } from "./tipos";

/** "Vencendo" = vence em ate 90 dias (inclusive) e ainda nao foi consumido. */
export const HORIZONTE_VENCIMENTO_DIAS = 90;

const CARTEIRAS: readonly Carteira[] = ["ferias", "folga"];

/** Campos do pedido que o saldo le. `Pedido` satisfaz. */
export type PedidoDebito = Pick<
  Pedido,
  "id" | "pessoaId" | "tipoId" | "inicio" | "fim" | "status" | "diasDebitoPorAno" | "canceladoEm"
>;

export interface EntradaSaldo {
  pessoaId: string;
  carteira: Carteira;
  hoje: DataISO;
  lancamentos: readonly Lancamento[];
  pedidos: readonly PedidoDebito[];
  tipos: readonly Tipo[];
  cal: CalendarioUtil;
}

export interface LoteSaldo {
  lancamentoId: number;
  ano: number;
  venceEm: DataISO | null;
  /** Dias que sobraram depois do FIFO. */
  dias: number;
}

export interface ResultadoSaldo {
  /** Soma dos lotes que ainda contam em `hoje` menos o excedente. Pode ser negativo. */
  disponivel: number;
  /** Dias de debito que nenhum credito cobriu. */
  excedente: number;
  /** Dias que sobraram em lotes ja vencidos em `hoje` (nao contam). */
  vencidos: number;
  /** Lotes que vencem em ate 90 dias e ainda tem saldo: total e a primeira data. */
  vencendo: { dias: number; venceEm: DataISO } | null;
  /** Lotes com saldo que ainda contam em `hoje`, na ordem FIFO. */
  lotes: LoteSaldo[];
}

/** Dias uteis por ano ("2026": 5, "2027": 2) do intervalo. Lanca se o intervalo for invalido. */
export function diasDebitoPorAno(inicio: DataISO, fim: DataISO, cal: CalendarioUtil): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const d of diasUteisEntre(inicio, fim, cal)) {
    const ano = d.slice(0, 4);
    saida[ano] = (saida[ano] ?? 0) + 1;
  }
  return saida;
}

/** Soma dos dias congelados de um pedido. */
export function totalDebito(porAno: Record<string, number>): number {
  if (porAno === null || typeof porAno !== "object") throw numeroInvalido("diasDebitoPorAno ausente");
  return Object.entries(porAno).reduce((soma, [ano, dias]) => {
    if (!/^\d{4}$/.test(ano) || !Number.isInteger(dias) || dias < 0) throw numeroInvalido("diasDebitoPorAno invalido");
    return soma + dias;
  }, 0);
}

function exigirCarteira(c: unknown): Carteira {
  if (!CARTEIRAS.includes(c as Carteira)) {
    throw new ErroDominio("NAO_ENCONTRADO", "carteira desconhecida");
  }
  return c as Carteira;
}

function exigirPessoa(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new ErroDominio("NAO_ENCONTRADO", "pessoaId vazio");
  }
  return id;
}

function numeroInvalido(msg: string): ErroDominio {
  return new ErroDominio("NUMERO_INVALIDO", msg);
}

interface Lote {
  id: number;
  ano: number;
  venceEm: DataISO | null;
  restante: number;
}

/** Menor venceEm primeiro; sem vencimento por ultimo; empate por id. */
function ordemFifo(a: Lote, b: Lote): number {
  if (a.venceEm !== b.venceEm) {
    if (a.venceEm === null) return 1;
    if (b.venceEm === null) return -1;
    return a.venceEm < b.venceEm ? -1 : 1;
  }
  return a.id - b.id;
}

function lerCreditados(lancamentos: readonly Lancamento[], pessoaId: string, carteira: Carteira) {
  const lotes: Lote[] = [];
  const baixas: { id: number; ano: number; dias: number }[] = [];
  for (const l of lancamentos) {
    if (l.pessoaId !== pessoaId || l.carteira !== carteira) continue;
    if (l.tipo !== "credito" && l.tipo !== "ajuste") throw numeroInvalido(`lancamento ${l.id}: tipo desconhecido`);
    if (!Number.isInteger(l.dias) || l.dias === 0) throw numeroInvalido(`lancamento ${l.id}: dias deve ser inteiro != 0`);
    if (l.tipo === "credito" && l.dias < 0) throw numeroInvalido(`lancamento ${l.id}: credito negativo`);
    if (!Number.isInteger(l.ano) || l.ano < 0 || l.ano > 9999) throw numeroInvalido(`lancamento ${l.id}: ano invalido`);
    const venceEm = l.venceEm === undefined ? null : validarData(l.venceEm, "venceEm");
    if (l.dias > 0) lotes.push({ id: l.id, ano: l.ano, venceEm, restante: l.dias });
    else baixas.push({ id: l.id, ano: l.ano, dias: -l.dias });
  }
  return { lotes: lotes.sort(ordemFifo), baixas: baixas.sort((a, b) => a.id - b.id) };
}

interface DiaDeDebito {
  data: DataISO;
  pedidoId: number;
  ano: number;
}

function lerDebitos(
  pedidos: readonly PedidoDebito[],
  pessoaId: string,
  carteira: Carteira,
  tipos: ReadonlyMap<string, Tipo>,
  cal: CalendarioUtil,
): DiaDeDebito[] {
  const saida: DiaDeDebito[] = [];
  for (const p of pedidos) {
    if (p.pessoaId !== pessoaId) continue;
    const tipo = tipos.get(p.tipoId);
    if (tipo === undefined) throw new ErroDominio("NAO_ENCONTRADO", `tipo do pedido ${p.id} desconhecido`);
    if (tipo.consomeSaldo !== carteira) continue;
    const vigente = intervaloVigente(p);
    if (vigente === null) continue;
    const congelado = p.diasDebitoPorAno;
    if (congelado === null || typeof congelado !== "object") throw numeroInvalido(`pedido ${p.id}: diasDebitoPorAno ausente`);
    const uteis = diasUteisEntre(vigente.inicio, vigente.fim, cal);
    const porAno = new Map<string, DataISO[]>();
    for (const d of uteis) porAno.set(d.slice(0, 4), [...(porAno.get(d.slice(0, 4)) ?? []), d]);
    for (const [ano, qtdBruta] of Object.entries(congelado)) {
      if (!/^\d{4}$/.test(ano) || !Number.isInteger(qtdBruta) || qtdBruta < 0 || qtdBruta > 366) {
        throw numeroInvalido(`pedido ${p.id}: diasDebitoPorAno invalido`);
      }
      const ultimoDoAno = vigente.fim.slice(0, 4) === ano ? vigente.fim : `${ano}-12-31`;
      // Cancelado: `diasDebitoPorAno` ja foi regravado no cancelamento (dias realmente ocupados
      // ate canceladoEm-1). Nem a QUANTIDADE nem as DATAS de consumo podem depender do calendario
      // de hoje: um feriado cadastrado depois mudaria o FIFO de dias ja consumidos. As datas
      // viram dias corridos a partir do inicio do periodo no ano (deterministico).
      const dias =
        p.status === "cancelada"
          ? Array.from({ length: qtdBruta }, (_, k) => {
              const inicioNoAno = vigente.inicio.slice(0, 4) === ano ? vigente.inicio : `${ano}-01-01`;
              const d = somarDias(inicioNoAno, k);
              return d > ultimoDoAno ? ultimoDoAno : d;
            })
          : (porAno.get(ano) ?? []);
      const qtd = qtdBruta;
      for (let k = 0; k < qtd; k++) {
        saida.push({ data: dias[k] ?? dias[dias.length - 1] ?? ultimoDoAno, pedidoId: p.id, ano: Number(ano) });
      }
    }
  }
  return saida.sort((a, b) => (a.data === b.data ? a.pedidoId - b.pedidoId : a.data < b.data ? -1 : 1));
}

export function saldo(entrada: EntradaSaldo): ResultadoSaldo {
  const pessoaId = exigirPessoa(entrada.pessoaId);
  const carteira = exigirCarteira(entrada.carteira);
  const hoje = validarData(entrada.hoje, "hoje");
  const tipos = new Map(entrada.tipos.map((t) => [t.id, t]));

  const { lotes, baixas } = lerCreditados(entrada.lancamentos, pessoaId, carteira);
  const debitos = lerDebitos(entrada.pedidos, pessoaId, carteira, tipos, entrada.cal);
  const vale = (l: Lote) => l.venceEm === null || l.venceEm >= hoje;

  let excedente = 0;
  // Baixas (ajuste negativo) tiram dos lotes do mesmo ano que ainda valem hoje.
  for (const b of baixas) {
    let falta = b.dias;
    for (const l of lotes) {
      if (falta === 0) break;
      if (l.ano !== b.ano || l.restante === 0 || !vale(l)) continue;
      const tirar = Math.min(falta, l.restante);
      l.restante -= tirar;
      falta -= tirar;
    }
    excedente += falta;
  }
  // Cada dia de debito consome o lote mais proximo de vencer que ainda valia no dia de uso.
  for (const d of debitos) {
    const lote = lotes.find((l) => l.ano === d.ano && l.restante > 0 && (l.venceEm === null || l.venceEm >= d.data));
    if (lote === undefined) excedente += 1;
    else lote.restante -= 1;
  }

  const validos = lotes.filter((l) => l.restante > 0 && vale(l));
  const vencidos = lotes.filter((l) => l.restante > 0 && !vale(l)).reduce((s, l) => s + l.restante, 0);
  const limite = somarDias(hoje, HORIZONTE_VENCIMENTO_DIAS);
  const janela = validos.filter((l) => l.venceEm !== null && l.venceEm <= limite);
  const vencendo =
    janela.length === 0
      ? null
      : {
          dias: janela.reduce((s, l) => s + l.restante, 0),
          venceEm: janela.reduce((m, l) => ((l.venceEm as DataISO) < m ? (l.venceEm as DataISO) : m), janela[0].venceEm as DataISO),
        };
  return {
    disponivel: validos.reduce((s, l) => s + l.restante, 0) - excedente,
    excedente,
    vencidos,
    vencendo,
    lotes: validos.map((l) => ({ lancamentoId: l.id, ano: l.ano, venceEm: l.venceEm, dias: l.restante })),
  };
}

export interface EntradaSimulacao extends EntradaSaldo {
  tipoId: string;
  inicio: DataISO;
  fim: DataISO;
}

export interface ResultadoSimulacao {
  diasUteis: number;
  diasDebitoPorAno: Record<string, number>;
  /** `null` quando o tipo nao consome saldo (`consomeSaldo: null`). */
  saldoAntes: number | null;
  saldoDepois: number | null;
  /** O pedido aumenta o debito sem credito que o cubra. Excedente e permitido, com justificativa. */
  excedeSaldo: boolean;
}

/**
 * Saldo antes/depois de um pedido hipotetico (pendente) da `pessoaId`, SEM gravar.
 * `entrada.carteira` e ignorada: a carteira vem de `tipo.consomeSaldo`.
 */
export function simularPedido(entrada: EntradaSimulacao): ResultadoSimulacao {
  const pessoaId = exigirPessoa(entrada.pessoaId);
  validarData(entrada.hoje, "hoje");
  const tipo = entrada.tipos.find((t) => t.id === entrada.tipoId);
  if (tipo === undefined) throw new ErroDominio("NAO_ENCONTRADO", "tipo desconhecido");
  const porAno = diasDebitoPorAno(entrada.inicio, entrada.fim, entrada.cal);
  const diasUteis = totalDebito(porAno);
  if (tipo.consomeSaldo === null) {
    return { diasUteis, diasDebitoPorAno: porAno, saldoAntes: null, saldoDepois: null, excedeSaldo: false };
  }
  const base = { ...entrada, pessoaId, carteira: tipo.consomeSaldo };
  const antes = saldo(base);
  const hipotetico: PedidoDebito = {
    id: Number.MAX_SAFE_INTEGER,
    pessoaId,
    tipoId: tipo.id,
    inicio: entrada.inicio,
    fim: entrada.fim,
    status: "pendente",
    diasDebitoPorAno: porAno,
  };
  const depois = saldo({ ...base, pedidos: [...entrada.pedidos, hipotetico] });
  return { diasUteis, diasDebitoPorAno: porAno, saldoAntes: antes.disponivel, saldoDepois: depois.disponivel, excedeSaldo: depois.excedente > antes.excedente };
}
