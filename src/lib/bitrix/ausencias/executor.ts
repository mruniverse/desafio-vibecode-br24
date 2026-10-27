/**
 * Executor de sincronizacao com o Bitrix: PURO e injetavel.
 * Sem banco, sem logger, sem rede propria: recebe uma PortaBitrix e um job e
 * devolve o resultado; quem persiste o estado e o servico (C2).
 *
 * Regras (BR24-005 v2.2):
 *  - adicionar: SEMPRE busca o marcador antes de criar (um add anterior pode ter
 *    criado o evento e perdido a resposta); achou => ok com o id existente.
 *  - remover: busca o marcador e remove; NOT_FOUND (ou evento ausente) = `removido`.
 *  - ate `maxTentativas` (3) tentativas no total, contando `job.tentativas` ja
 *    gastas; esgotadas => `falha_manual`. Erro permanente (escrita bloqueada,
 *    permissao, entrada invalida) => `falha_manual` sem repetir.
 *  - jobs do MESMO pedido na MESMA porta rodam em serie (fila em memoria). Isto
 *    cobre concorrencia dentro do processo; entre processos quem serializa e o
 *    lease do `sync_job` (C2).
 *  - erro devolvido passa por `sanitizarMensagem`: sem URL de webhook.
 *  - o evento enviado e montado campo a campo: justificativa/motivo que
 *    venham no objeto do job nao cruzam a porta.
 */
import { NOME_EVENTO_BITRIX } from "../../ausencias/tipos";
import type { DataISO, StatusSincronizacao } from "../../ausencias/tipos";
import type { PortaBitrix } from "../../ausencias/portas";
import { ehErroPortaBitrix, mensagemSegura } from "./erros";
import {
  exigirInteiroPositivo,
  exigirIntervalo,
  montarMarcador,
} from "./util";

export const MAX_TENTATIVAS_SINCRONIZACAO = 3;

export interface JobSincronizacao {
  operacao: "adicionar" | "remover";
  pedidoId: number;
  ownerId: number;
  inicio: DataISO;
  fim: DataISO;
  /** Tentativas ja gastas em execucoes anteriores. */
  tentativas: number;
  /** Opcional: id conhecido, usado so se o marcador nao for achado ao remover. */
  bitrixEventId?: string;
}

export interface ResultadoSincronizacao {
  sincronizacao: Extract<StatusSincronizacao, "ok" | "removido" | "falha" | "falha_manual">;
  bitrixEventId?: string;
  secao?: number;
  erro?: string;
  /** Total acumulado (job.tentativas + as feitas agora). */
  tentativas: number;
  /**
   * `true` so quando a falha de um `adicionar` aconteceu ANTES de qualquer escrita
   * possivel (leitura falhou, escrita bloqueada, entrada invalida): nao ha evento
   * pendente de aparecer no Bitrix, entao nao e criacao incerta. Ausente/false =
   * pode ter havido escrita; tratar como incerto.
   */
  semEscrita?: boolean;
}

/** Erros lancados pela porta ANTES de qualquer requisicao de escrita. */
const CODIGOS_PRE_ESCRITA: ReadonlySet<string> = new Set(["ESCRITA_BLOQUEADA", "ENTRADA_INVALIDA"]);

export interface OpcoesExecutor {
  maxTentativas?: number;
  /** Pausa entre tentativas (default: nenhuma, "imediatas"). */
  pausa?: (tentativaFeita: number) => Promise<void>;
}

const filas = new WeakMap<object, Map<number, Promise<void>>>();

async function emSerie<T>(porta: object, pedidoId: number, fn: () => Promise<T>): Promise<T> {
  let mapa = filas.get(porta);
  if (!mapa) {
    mapa = new Map();
    filas.set(porta, mapa);
  }
  const anterior = mapa.get(pedidoId) ?? Promise.resolve();
  const atual = anterior.then(fn);
  const cauda = atual.then(
    () => undefined,
    () => undefined,
  );
  mapa.set(pedidoId, cauda);
  try {
    return await atual;
  } finally {
    if (mapa.get(pedidoId) === cauda) mapa.delete(pedidoId);
  }
}

export async function executarSincronizacao(
  porta: PortaBitrix,
  job: JobSincronizacao,
  opcoes: OpcoesExecutor = {},
): Promise<ResultadoSincronizacao> {
  const invalido = validarJob(job);
  if (invalido) {
    return {
      sincronizacao: "falha_manual",
      erro: mensagemSegura(`job invalido: ${invalido}`),
      tentativas: Number.isFinite(job?.tentativas) ? job.tentativas : 0,
      // Nenhuma chamada a porta aconteceu: nao ha evento pendente de aparecer.
      semEscrita: true,
    };
  }
  // Copia so os campos do contrato: nada alem disso atravessa a porta.
  const limpo: JobSincronizacao = {
    operacao: job.operacao,
    pedidoId: job.pedidoId,
    ownerId: job.ownerId,
    inicio: job.inicio,
    fim: job.fim,
    tentativas: job.tentativas,
    bitrixEventId: job.bitrixEventId,
  };
  return emSerie(porta, limpo.pedidoId, () => executar(porta, limpo, opcoes));
}

function validarJob(job: JobSincronizacao): string | null {
  try {
    if (job?.operacao !== "adicionar" && job?.operacao !== "remover") {
      return "operacao desconhecida";
    }
    exigirInteiroPositivo(job.pedidoId, "pedidoId");
    exigirInteiroPositivo(job.ownerId, "ownerId");
    exigirIntervalo(job.inicio, job.fim);
    if (!Number.isInteger(job.tentativas) || job.tentativas < 0) {
      return "tentativas deve ser inteiro >= 0";
    }
    return null;
  } catch (erro) {
    return mensagemSegura(erro);
  }
}

async function executar(
  porta: PortaBitrix,
  job: JobSincronizacao,
  opcoes: OpcoesExecutor,
): Promise<ResultadoSincronizacao> {
  const max = opcoes.maxTentativas ?? MAX_TENTATIVAS_SINCRONIZACAO;
  let tentativas = job.tentativas;
  let ultimoErro = "";
  // Alguma tentativa chegou a enviar a criacao (e nao foi barrada antes de sair)?
  let escritaPossivel = false;

  if (tentativas >= max) {
    return {
      sincronizacao: "falha_manual",
      erro: "limite de tentativas atingido: requer acao do administrador",
      tentativas,
    };
  }

  while (tentativas < max) {
    tentativas += 1;
    const marca = { iniciouEscrita: false };
    try {
      if (job.operacao === "adicionar") {
        const r = await adicionar(porta, job, marca);
        return { sincronizacao: "ok", bitrixEventId: r.id, secao: r.secao, tentativas };
      }
      await remover(porta, job);
      return { sincronizacao: "removido", tentativas };
    } catch (erro) {
      ultimoErro = mensagemSegura(erro);
      const barradaAntes = ehErroPortaBitrix(erro) && CODIGOS_PRE_ESCRITA.has(erro.codigo);
      if (marca.iniciouEscrita && !barradaAntes) escritaPossivel = true;
      if (ehErroPortaBitrix(erro) && !erro.transitorio) {
        return { sincronizacao: "falha_manual", erro: ultimoErro, tentativas, semEscrita: !escritaPossivel };
      }
      if (tentativas < max && opcoes.pausa) await opcoes.pausa(tentativas);
    }
  }
  return { sincronizacao: "falha_manual", erro: ultimoErro, tentativas, semEscrita: !escritaPossivel };
}

async function adicionar(
  porta: PortaBitrix,
  job: JobSincronizacao,
  marca: { iniciouEscrita: boolean },
): Promise<{ id: string; secao?: number }> {
  const marcador = montarMarcador(job.pedidoId);
  const existente = await porta.buscarEvento(marcador, job.ownerId, job.inicio, job.fim);
  if (existente) return { id: existente.id };
  marca.iniciouEscrita = true;
  return porta.criarEvento({
    marcador,
    ownerId: job.ownerId,
    inicio: job.inicio,
    fim: job.fim,
    nome: NOME_EVENTO_BITRIX,
  });
}

async function remover(porta: PortaBitrix, job: JobSincronizacao): Promise<void> {
  const marcador = montarMarcador(job.pedidoId);
  const achado = await porta.buscarEvento(marcador, job.ownerId, job.inicio, job.fim);
  const id = achado?.id ?? job.bitrixEventId;
  if (!id) return; // nada a remover: ja removido
  try {
    await porta.removerEvento(id, job.ownerId);
  } catch (erro) {
    if (ehErroPortaBitrix(erro) && erro.codigo === "NOT_FOUND") return;
    throw erro;
  }
}
