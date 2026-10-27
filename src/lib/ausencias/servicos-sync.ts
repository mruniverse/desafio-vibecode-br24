/**
 * Sincronizacao INLINE com o Bitrix (BR24-005 v2.2, item 11): sem worker.
 * Depois da transacao que enfileirou o job (aprovar -> `adicionar`; cancelar
 * aprovada -> `remover`), roda a fila do portal com o executor do C3 (ate 3
 * tentativas imediatas) e persiste o resultado nos repositorios.
 *
 * - O executor e PURO: so recebe campos do contrato (pedidoId, ownerId,
 *   periodo). Tipo, justificativa e motivo nunca chegam aqui.
 * - Nenhuma transacao do SQLite fica aberta durante o `await` da porta.
 * - Um add em andamento bloqueia outras operacoes mesmo apos vencer o lease:
 *   o Bitrix nao oferece fencing. Uma resposta incerta exige revisao manual.
 */
import { executarSincronizacao } from "@/lib/bitrix/ausencias/executor";
import type { OpcoesExecutor } from "@/lib/bitrix/ausencias/executor";
import { mensagemSegura } from "@/lib/bitrix/ausencias/erros";
import { logger } from "@/lib/logger";
import { somarHoras } from "./datas";
import { ErroDominio } from "./erros";
import type { PortaBitrix } from "./portas";
import { obterPessoa } from "./repo/catalogo";
import { lerPedidoInterno } from "./repo/pedidos";
import { concluirJob, esgotarJob, MAX_TENTATIVAS_SYNC, registrarAddIncerto, tomarProximoJob } from "./repo/sync";
import type { Relogio } from "./tipos";

/** Teto de jobs por rodada (evita laco longo numa requisicao). */
const MAX_JOBS_POR_RODADA = 25;
const LEASE_HORAS = 1;

export interface DepsSincronizacao {
  portalMemberId: string;
  relogio: Relogio;
  porta: PortaBitrix;
  opcoesExecutor?: OpcoesExecutor;
}

/**
 * Grava o resultado de uma tentativa. Se o lease venceu e outro processo assumiu
 * o job (geracao diferente), a gravacao antiga e descartada: quem manda e a
 * tentativa mais nova. Qualquer outro erro sobe normalmente.
 */
function gravar(escrever: () => void): void {
  try {
    escrever();
  } catch (erro) {
    if (erro instanceof ErroDominio && erro.subcodigo === "TRANSICAO_INVALIDA") {
      logger.warn({ evento: "ausencias.sincronizacao.tentativa-antiga-descartada" });
      return;
    }
    throw erro;
  }
}

/** Roda a fila do portal. Devolve quantos jobs foram processados. */
export async function processarFilaSincronizacao(deps: DepsSincronizacao): Promise<number> {
  const { portalMemberId: m, relogio, porta } = deps;
  let processados = 0;
  while (processados < MAX_JOBS_POR_RODADA) {
    const agora = relogio.agora();
    const job = tomarProximoJob(m, agora, somarHoras(agora, LEASE_HORAS));
    if (!job) break;
    processados += 1;

    const pedido = lerPedidoInterno(m, job.pedidoId);
    if (!pedido) {
      gravar(() => esgotarJob(m, job.id, "pedido inexistente", relogio.agora(), job.tentativas, job.geracao));
      continue;
    }
    const pessoa = obterPessoa(m, pedido.pessoaId);
    const ownerId = pedido.ownerId ?? pessoa?.bitrixUserId;
    if (ownerId === undefined) {
      gravar(() => esgotarJob(m, job.id, "pessoa sem usuario do Bitrix vinculado", relogio.agora(), MAX_TENTATIVAS_SYNC, job.geracao));
      continue;
    }

    let resultado;
    try {
      resultado = await executarSincronizacao(
        porta,
        {
          operacao: job.operacao,
          pedidoId: pedido.id,
          ownerId,
          inicio: pedido.inicio,
          fim: pedido.fim,
          // `tomarProximoJob` ja contou esta tentativa; o executor soma as dele.
          tentativas: Math.max(0, job.tentativas - 1),
          bitrixEventId: pedido.bitrixEventId,
        },
        // Nao repetir add apos erro: a escrita anterior pode ainda acontecer,
        // mesmo que uma busca pelo marcador nao encontre nada neste instante.
        job.operacao === "adicionar"
          ? { ...deps.opcoesExecutor, maxTentativas: job.tentativas }
          : deps.opcoesExecutor,
      );
    } catch (erro) {
      if (job.operacao === "adicionar") gravar(() => registrarAddIncerto(m, job.id, relogio.agora(), job.geracao));
      else gravar(() => esgotarJob(m, job.id, mensagemSegura(erro), relogio.agora(), job.tentativas, job.geracao));
      continue;
    }

    if (resultado.sincronizacao === "ok" || resultado.sincronizacao === "removido") {
      gravar(() => concluirJob(m, job.id, relogio.agora(), {
        bitrixEventId: resultado.bitrixEventId,
        ownerId,
        secao: resultado.secao,
      }, job.geracao));
    } else if (job.operacao === "adicionar" && resultado.semEscrita !== true) {
      // Pode ter havido escrita: o evento ainda pode aparecer. Exige reconciliacao.
      gravar(() => registrarAddIncerto(m, job.id, relogio.agora(), job.geracao));
    } else {
      // Remocao, ou criacao que falhou comprovadamente ANTES de escrever: nada
      // pendente no Bitrix; fica reprocessavel e nao trava a remocao.
      gravar(() => esgotarJob(m, job.id, resultado.erro ?? "falha na sincronizacao", relogio.agora(), resultado.tentativas, job.geracao));
    }
  }
  if (processados > 0) {
    logger.info({ evento: "ausencias.sincronizacao.rodada", detalhe: { processados } });
  }
  return processados;
}
