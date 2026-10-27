/**
 * Maquina de estados do pedido (BR24-005 v2.2, item 1).
 *
 * `status` (decisao) e `sincronizacao` (espelho no calendario do Bitrix) sao
 * campos separados. Pares validos:
 *
 *   pendente | recusada -> nao_aplicavel
 *   aprovada            -> pendente | em_andamento | ok | falha | falha_manual
 *   cancelada           -> nao_aplicavel | remocao_pendente | em_andamento |
 *                          removido | falha | falha_manual
 *
 * Toda funcao devolve um objeto NOVO; a entrada nunca e alterada, entao uma
 * transicao invalida (ErroDominio TRANSICAO_INVALIDA) deixa o estado intacto.
 * `versao` e persistencia (UPDATE ... WHERE versao=?) ficam com o C2.
 *
 * Idempotencia por `pedido.id` e do servico (UPDATE ... WHERE status=?, changes===1):
 * repetir uma transicao aqui e erro, nao no-op.
 */
import { somarDias, validarData, validarInstante, validarIntervalo, type DataISO, type InstanteISO } from "./datas";
import { ErroDominio } from "./erros";
import type { Papel, Pedido, StatusPedido, StatusSincronizacao } from "./tipos";

/** Tentativas de sincronizacao antes de escalar para `falha_manual` (acao do admin). */
export const MAX_TENTATIVAS_SYNC = 3;
/** Tamanho minimo do `motivoDecisao` de uma recusa. */
export const MIN_CARACTERES_MOTIVO = 10;

export const STATUS_PEDIDO: readonly StatusPedido[] = ["pendente", "aprovada", "recusada", "cancelada"];
export const STATUS_SINCRONIZACAO: readonly StatusSincronizacao[] = [
  "nao_aplicavel",
  "pendente",
  "em_andamento",
  "ok",
  "falha",
  "remocao_pendente",
  "removido",
  "falha_manual",
];

export interface EstadoPedido {
  status: StatusPedido;
  sincronizacao: StatusSincronizacao;
}

/** Campos do pedido que as transicoes leem. `Pedido` satisfaz. */
export type PedidoEstado = Pick<Pedido, "id" | "pessoaId" | "inicio" | "fim" | "status" | "sincronizacao">;

const SINCRONIZACOES_POR_STATUS: Record<StatusPedido, readonly StatusSincronizacao[]> = {
  pendente: ["nao_aplicavel"],
  recusada: ["nao_aplicavel"],
  aprovada: ["pendente", "em_andamento", "ok", "falha", "falha_manual"],
  cancelada: ["nao_aplicavel", "remocao_pendente", "em_andamento", "removido", "falha", "falha_manual"],
};

/** Arestas permitidas, chave "status/sincronizacao". Tudo fora daqui e TRANSICAO_INVALIDA. */
const TRANSICOES: Record<string, readonly string[]> = {
  "pendente/nao_aplicavel": ["aprovada/pendente", "recusada/nao_aplicavel", "cancelada/nao_aplicavel"],
  "aprovada/pendente": ["aprovada/em_andamento", "cancelada/remocao_pendente"],
  "aprovada/em_andamento": ["aprovada/ok", "aprovada/falha", "aprovada/falha_manual", "cancelada/remocao_pendente"],
  "aprovada/ok": ["cancelada/remocao_pendente"],
  "aprovada/falha": ["aprovada/em_andamento", "cancelada/remocao_pendente"],
  "aprovada/falha_manual": ["aprovada/em_andamento", "cancelada/remocao_pendente"],
  "cancelada/remocao_pendente": ["cancelada/em_andamento"],
  "cancelada/em_andamento": ["cancelada/removido", "cancelada/falha", "cancelada/falha_manual"],
  "cancelada/falha": ["cancelada/em_andamento"],
  "cancelada/falha_manual": ["cancelada/em_andamento"],
};

function chave(e: EstadoPedido): string {
  return `${e.status}/${e.sincronizacao}`;
}

/** O par (status, sincronizacao) existe? */
export function estadoValido(e: EstadoPedido): boolean {
  if (e === null || typeof e !== "object") return false;
  const permitidas = SINCRONIZACOES_POR_STATUS[e.status];
  return permitidas !== undefined && Object.hasOwn(SINCRONIZACOES_POR_STATUS, e.status) && permitidas.includes(e.sincronizacao);
}

/** Devolve o estado ou lanca TRANSICAO_INVALIDA se o par nao existir. */
export function validarEstado(e: EstadoPedido): EstadoPedido {
  if (!estadoValido(e)) {
    throw new ErroDominio("TRANSICAO_INVALIDA", `estado invalido: ${String(e?.status)}/${String(e?.sincronizacao)}`);
  }
  return e;
}

/** `de -> para` esta na matriz? Estados inexistentes nunca sao permitidos. */
export function transicaoPermitida(de: EstadoPedido, para: EstadoPedido): boolean {
  if (!estadoValido(de) || !estadoValido(para)) return false;
  return (TRANSICOES[chave(de)] ?? []).includes(chave(para));
}

/** Aplica a transicao generica da matriz. Lanca TRANSICAO_INVALIDA; nunca altera `p`. */
export function mudarEstado<T extends EstadoPedido>(p: T, para: EstadoPedido): T {
  if (!transicaoPermitida(p, para)) {
    throw new ErroDominio(
      "TRANSICAO_INVALIDA",
      `transicao nao permitida: ${String(p?.status)}/${String(p?.sincronizacao)} -> ${String(para?.status)}/${String(para?.sincronizacao)}`,
    );
  }
  return { ...p, status: para.status, sincronizacao: para.sincronizacao };
}

function exigirAtor(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new ErroDominio("SEM_PERMISSAO", "ator nao identificado");
  }
  return id;
}

function exigirPapel(papel: unknown): Papel {
  if (papel !== "colaborador" && papel !== "gestor" && papel !== "admin") {
    throw new ErroDominio("SEM_PERMISSAO", "papel desconhecido");
  }
  return papel;
}

function exigirTentativas(n: unknown): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new ErroDominio("NUMERO_INVALIDO", "tentativas deve ser inteiro >= 0");
  }
  return n;
}

/** pendente -> aprovada (sincronizacao pendente). Ninguem aprova o proprio pedido. */
export function aprovar<T extends PedidoEstado>(p: T, atorId: string, agora: InstanteISO): T {
  const novo = mudarEstado(p, { status: "aprovada", sincronizacao: "pendente" });
  const ator = exigirAtor(atorId);
  if (ator === p.pessoaId) throw new ErroDominio("SEM_PERMISSAO", "ninguem aprova o proprio pedido");
  return { ...novo, decididoPor: ator, decididoEm: validarInstante(agora, "agora") };
}

export interface EntradaRecusa {
  /** Obrigatorio, minimo MIN_CARACTERES_MOTIVO caracteres (apos trim). */
  motivoDecisao: string;
  /** "Sugerir outra data": so existe junto da recusa. */
  sugestao?: { inicio: DataISO; fim: DataISO };
}

/** pendente -> recusada. Exige motivo; aceita sugestao de outra data. */
export function recusar<T extends PedidoEstado>(p: T, atorId: string, agora: InstanteISO, entrada: EntradaRecusa): T {
  const novo = mudarEstado(p, { status: "recusada", sincronizacao: "nao_aplicavel" });
  const ator = exigirAtor(atorId);
  if (ator === p.pessoaId) throw new ErroDominio("SEM_PERMISSAO", "ninguem recusa o proprio pedido");
  const motivo = typeof entrada?.motivoDecisao === "string" ? entrada.motivoDecisao.trim() : "";
  if (motivo.length < MIN_CARACTERES_MOTIVO) {
    throw new ErroDominio("JUSTIFICATIVA_OBRIGATORIA", `recusa exige motivo com ao menos ${MIN_CARACTERES_MOTIVO} caracteres`);
  }
  const sugestao = entrada.sugestao === undefined ? undefined : validarIntervalo(entrada.sugestao.inicio, entrada.sugestao.fim);
  const decididoEm = validarInstante(agora, "agora");
  const resultado = { ...novo, motivoDecisao: motivo, decididoPor: ator, decididoEm };
  return sugestao === undefined ? resultado : { ...resultado, sugestao };
}

/**
 * pendente|aprovada -> cancelada, com `canceladoEm = hoje`.
 *
 * Quem cancela: o proprio pedido so antes do inicio (`hoje < inicio`), exceto admin;
 * pedido de outra pessoa so por gestor/admin (o escopo de equipe e do servico).
 * Pendente vira `nao_aplicavel`; aprovada vira `remocao_pendente` (o job busca o
 * marcador no Bitrix; NOT_FOUND = removido).
 */
export function cancelar<T extends PedidoEstado>(p: T, ator: { id: string; papel: Papel }, hoje: DataISO): T {
  const para: EstadoPedido =
    p.status === "aprovada"
      ? { status: "cancelada", sincronizacao: "remocao_pendente" }
      : { status: "cancelada", sincronizacao: "nao_aplicavel" };
  const novo = mudarEstado(p, para);
  const id = exigirAtor(ator?.id);
  const papel = exigirPapel(ator.papel);
  const dia = validarData(hoje, "hoje");
  if (id === p.pessoaId) {
    if (papel !== "admin" && !(dia < p.inicio)) {
      throw new ErroDominio("SEM_PERMISSAO", "o proprio pedido so pode ser cancelado antes do inicio");
    }
  } else if (papel === "colaborador") {
    throw new ErroDominio("SEM_PERMISSAO", "colaborador cancela so o proprio pedido");
  }
  return { ...novo, canceladoEm: dia, canceladoPor: id };
}

/**
 * Inicia uma tentativa de sincronizacao (-> em_andamento) a partir de
 * pendente | remocao_pendente | falha. `tentativas` = tentativas ja feitas;
 * a partir de MAX_TENTATIVAS_SYNC so o admin retoma (`reprocessarManual`).
 */
export function iniciarSincronizacao<T extends PedidoEstado>(p: T, tentativas: number): T {
  const feitas = exigirTentativas(tentativas);
  if (p.sincronizacao === "falha_manual") {
    throw new ErroDominio("TRANSICAO_INVALIDA", "falha_manual so e retomada pelo admin (reprocessarManual)");
  }
  const novo = mudarEstado(p, { status: p.status, sincronizacao: "em_andamento" });
  if (p.sincronizacao === "falha" && feitas >= MAX_TENTATIVAS_SYNC) {
    throw new ErroDominio("TRANSICAO_INVALIDA", `limite de ${MAX_TENTATIVAS_SYNC} tentativas atingido`);
  }
  return novo;
}

/** em_andamento -> ok (aprovada) ou removido (cancelada). */
export function concluirSincronizacao<T extends PedidoEstado>(p: T): T {
  const destino: StatusSincronizacao = p.status === "cancelada" ? "removido" : "ok";
  return mudarEstado(p, { status: p.status, sincronizacao: destino });
}

/**
 * em_andamento -> falha, ou -> falha_manual quando `tentativas` (contando a que
 * acabou de falhar) chegou a MAX_TENTATIVAS_SYNC.
 */
export function falharSincronizacao<T extends PedidoEstado>(p: T, tentativas: number): T {
  const feitas = exigirTentativas(tentativas);
  const destino: StatusSincronizacao = feitas >= MAX_TENTATIVAS_SYNC ? "falha_manual" : "falha";
  return mudarEstado(p, { status: p.status, sincronizacao: destino });
}

/** falha_manual -> em_andamento, so pelo admin (o servico zera as tentativas do job). */
export function reprocessarManual<T extends PedidoEstado>(p: T, ator: { id: string; papel: Papel }): T {
  if (p.sincronizacao !== "falha_manual") {
    throw new ErroDominio("TRANSICAO_INVALIDA", "reprocessamento manual so vale em falha_manual");
  }
  exigirAtor(ator?.id);
  if (exigirPapel(ator.papel) !== "admin") {
    throw new ErroDominio("SEM_PERMISSAO", "so o admin reprocessa falha_manual");
  }
  return mudarEstado(p, { status: p.status, sincronizacao: "em_andamento" });
}

/**
 * Intervalo em que o pedido ainda "conta" (saldo, cobertura, calendario):
 * pendente|aprovada = [inicio, fim]; cancelada = [inicio, min(fim, canceladoEm-1)]
 * (null se nada sobra); recusada = null. Cancelada sem `canceladoEm` e dado
 * inconsistente e lanca DATA_INVALIDA.
 */
export function intervaloVigente(
  p: Pick<Pedido, "status" | "inicio" | "fim" | "canceladoEm">,
): { inicio: DataISO; fim: DataISO } | null {
  const { inicio, fim } = validarIntervalo(p.inicio, p.fim);
  if (p.status === "recusada") return null;
  if (p.status !== "cancelada") return { inicio, fim };
  if (p.canceladoEm === undefined) {
    throw new ErroDominio("DATA_INVALIDA", "pedido cancelado sem canceladoEm");
  }
  const ultimo = somarDias(validarData(p.canceladoEm, "canceladoEm"), -1);
  const fimVigente = ultimo < fim ? ultimo : fim;
  return fimVigente < inicio ? null : { inicio, fim: fimVigente };
}
