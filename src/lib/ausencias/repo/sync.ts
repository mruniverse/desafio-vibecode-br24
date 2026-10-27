/**
 * Repositorio da fila de sincronizacao (tabela sync_job, migracao 003).
 *
 * Fluxo: aprovar -> job `adicionar`; cancelar aprovada -> job `remover`.
 * O consumidor (C3) chama `tomarProximoJob` -> executa -> `concluirJob` ou
 * `falharJob`. Um add em andamento nao e retomado ao vencer o lease: nao ha
 * fencing no Bitrix. Remocao espera resultado conhecido; falha incerta exige
 * reconciliacao manual e nao pode ser reprocessada automaticamente.
 *
 * Invariante: job `adicionar` de pedido que nao esta mais `aprovada` nunca e
 * reaberto nem tomado — seria uma ausencia fantasma no Bitrix. Ele e descartado
 * (`falha_manual`) para nao segurar o `remover` atras dele.
 *
 * Cada transicao do job espelha `pedido.sincronizacao` na mesma transacao.
 */
import { conexao, emTransacao, exigirPortal } from "./base";
import { ErroDominio } from "../erros";
import type { InstanteISO } from "../tipos";
import type { SincronizacaoLogVisao } from "../visoes";

export const MAX_TENTATIVAS_SYNC = 3;
const TAMANHO_MAX_ERRO = 300;

export type OperacaoSync = "adicionar" | "remover";
export type EstadoJob = "pendente" | "em_andamento" | "ok" | "falha" | "falha_manual";

export interface SyncJob {
  id: number;
  pedidoId: number;
  operacao: OperacaoSync;
  estado: EstadoJob;
  tentativas: number;
  /** Fencing: sobe a cada tomada do job; quem grava o resultado devolve a que recebeu. */
  geracao: number;
  proximaEm?: InstanteISO;
  ultimoErro?: string;
  leaseAte?: InstanteISO;
  criadoEm: InstanteISO;
  atualizadoEm: InstanteISO;
}

interface LinhaJob {
  id: number;
  pedido_id: number;
  operacao: OperacaoSync;
  estado: EstadoJob;
  tentativas: number;
  geracao: number;
  proxima_em: string | null;
  ultimo_erro: string | null;
  lease_ate: string | null;
  criado_em: string;
  atualizado_em: string;
}

function paraJob(r: LinhaJob): SyncJob {
  const j: SyncJob = {
    id: r.id,
    pedidoId: r.pedido_id,
    operacao: r.operacao,
    estado: r.estado,
    tentativas: r.tentativas,
    geracao: r.geracao,
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
  if (r.proxima_em !== null) j.proximaEm = r.proxima_em;
  if (r.ultimo_erro !== null) j.ultimoErro = r.ultimo_erro;
  if (r.lease_ate !== null) j.leaseAte = r.lease_ate;
  return j;
}

/** Erro curto e em uma linha; nunca guarde motivo/justificativa aqui. */
function limparErro(erro: string): string {
  return erro.replace(/\s+/g, " ").trim().slice(0, TAMANHO_MAX_ERRO);
}

/** Status do pedido ao qual cada operacao se aplica. */
function statusAlvo(op: OperacaoSync): "aprovada" | "cancelada" {
  return op === "adicionar" ? "aprovada" : "cancelada";
}

/**
 * Fencing OBRIGATORIO: so o dono da tentativa mais recente grava o resultado.
 * Predicado SQL a acrescentar ao UPDATE (parametro `@ger`).
 */
const FENCING = "AND geracao = @ger";

function exigirGeracao(geracao: unknown): number {
  if (typeof geracao !== "number" || !Number.isInteger(geracao) || geracao < 1) {
    throw new ErroDominio("NUMERO_INVALIDO", "geracao da tentativa e obrigatoria (inteiro >= 1)");
  }
  return geracao;
}

function erroTentativaAntiga(jobId: number): ErroDominio {
  return new ErroDominio("TRANSICAO_INVALIDA", `sync_job ${jobId}: tentativa antiga (geracao desatualizada) ou fora de andamento`);
}

const MOTIVO_OBSOLETO = "pedido nao esta mais aprovado (cancelado): criacao descartada";
const ADD_INCERTO = "criacao com resultado incerto: reconciliacao manual necessaria";

/** Predicado SQL: o pedido do job `adicionar` ainda esta aprovado. */
const AINDA_APROVADO = `EXISTS (
  SELECT 1 FROM pedido p
   WHERE p.portal_member_id = @m AND p.id = sync_job.pedido_id AND p.status = 'aprovada')`;

/**
 * Mata os jobs de CRIACAO que perderam o sentido (pedido ja cancelado/recusado).
 * Sem isso, reabrir ou tomar o job recriaria no Bitrix uma ausencia fantasma de
 * um pedido que nao existe mais. Jobs EM VOO (mesmo com lease vencido) nao sao tocados: o
 * executor termina, e o job `remover` ja enfileirado desfaz o que ele criar.
 *
 * O estado final e `falha_manual` (e nao `pendente`) de proposito: e terminal,
 * nao volta para a fila e libera a serializacao para o job `remover` rodar.
 */
function descartarCriacoesObsoletas(
  db: ReturnType<typeof conexao>,
  portalMemberId: string,
  agora: InstanteISO,
  pedidoId?: number,
): void {
  db.prepare(
    `UPDATE sync_job
        SET estado = 'falha_manual', lease_ate = NULL, proxima_em = NULL,
            ultimo_erro = @motivo, atualizado_em = @agora
      WHERE portal_member_id = @m
        AND operacao = 'adicionar'
        AND (@pedido IS NULL OR pedido_id = @pedido)
        AND estado IN ('pendente', 'falha')
        AND NOT ${AINDA_APROVADO}`,
  ).run({ m: portalMemberId, pedido: pedidoId ?? null, agora, motivo: MOTIVO_OBSOLETO });
}

/**
 * Enfileira o job. Idempotente: UNIQUE(pedido_id, operacao) -> devolve false se
 * ja existia (nao reabre job concluido; para reabrir use `reprocessarJobs`).
 */
export function enfileirarJob(
  portalMemberId: string,
  pedidoId: number,
  operacao: OperacaoSync,
  agora: InstanteISO,
): boolean {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare(
      `INSERT INTO sync_job (portal_member_id, pedido_id, operacao, estado, tentativas, criado_em, atualizado_em)
       VALUES (@m, @pedido, @op, 'pendente', 0, @agora, @agora)
       ON CONFLICT (pedido_id, operacao) DO NOTHING`,
    )
    .run({ m: portalMemberId, pedido: pedidoId, op: operacao, agora });
  return r.changes === 1;
}

export function obterJob(portalMemberId: string, jobId: number): SyncJob | null {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare("SELECT * FROM sync_job WHERE portal_member_id = ? AND id = ?")
    .get(portalMemberId, jobId) as LinhaJob | undefined;
  return r ? paraJob(r) : null;
}

export function obterJobDoPedido(
  portalMemberId: string,
  pedidoId: number,
  operacao: OperacaoSync,
): SyncJob | null {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare(
      "SELECT * FROM sync_job WHERE portal_member_id = ? AND pedido_id = ? AND operacao = ?",
    )
    .get(portalMemberId, pedidoId, operacao) as LinhaJob | undefined;
  return r ? paraJob(r) : null;
}

type SincronizacaoEspelhada =
  | "em_andamento"
  | "ok"
  | "removido"
  | "falha"
  | "falha_manual"
  | "pendente"
  | "remocao_pendente";

function espelharNoPedido(
  portalMemberId: string,
  pedidoId: number,
  operacao: OperacaoSync,
  sincronizacao: SincronizacaoEspelhada,
  extra?: { bitrixEventId?: string; ownerId?: number; secao?: number },
): void {
  conexao()
    .prepare(
      `UPDATE pedido
          SET sincronizacao = @sinc,
              bitrix_event_id = COALESCE(@evento, bitrix_event_id),
              owner_id = COALESCE(@owner, owner_id),
              secao = COALESCE(@secao, secao)
        WHERE portal_member_id = @m AND id = @id AND status = @status`,
    )
    .run({
      m: portalMemberId,
      id: pedidoId,
      status: statusAlvo(operacao),
      sinc: sincronizacao,
      evento: extra?.bitrixEventId ?? null,
      owner: extra?.ownerId ?? null,
      secao: extra?.secao ?? null,
    });
}

/**
 * Pega (atomicamente) o proximo job executavel e abre um lease. Dois
 * processos nao recebem simultaneamente o mesmo lease. Um add vencido nunca e
 * retomado, pois ainda pode estar executando no destino.
 */
export function tomarProximoJob(
  portalMemberId: string,
  agora: InstanteISO,
  leaseAte: InstanteISO,
  /** Restringe a selecao a um pedido (usado pelo seed da demo; os demais jobs ficam intactos). */
  soPedidoId?: number,
): SyncJob | null {
  exigirPortal(portalMemberId);
  return emTransacao(() => {
    const db = conexao();
    // Pedido cancelado depois da falha: a criacao vira obsoleta e e descartada
    // ANTES da selecao, na mesma transacao imediata (fecha a corrida com quem
    // cancelou/reprocessou entre duas chamadas).
    descartarCriacoesObsoletas(db, portalMemberId, agora);
    // O processo original ainda pode voltar. Sinaliza a incerteza sem encerrar
    // o job nem permitir outro add/remove. Crash exige reconciliacao externa.
    db.prepare(`UPDATE pedido SET sincronizacao = 'falha_manual'
      WHERE portal_member_id = @m AND id IN (
        SELECT pedido_id FROM sync_job WHERE portal_member_id = @m
          AND operacao = 'adicionar' AND estado = 'em_andamento' AND lease_ate <= @agora
      )`).run({ m: portalMemberId, agora });
    db.prepare(`UPDATE sync_job SET ultimo_erro = @erro
      WHERE portal_member_id = @m AND operacao = 'adicionar'
        AND estado = 'em_andamento' AND lease_ate <= @agora`).run({ m: portalMemberId, agora, erro: ADD_INCERTO });
    // Lease vencido sem tentativas restantes: nao fica preso para sempre.
    const orfaos = db
      .prepare(
        `SELECT * FROM sync_job
          WHERE portal_member_id = @m AND estado = 'em_andamento'
            AND operacao <> 'adicionar' AND lease_ate <= @agora AND tentativas >= @max`,
      )
      .all({ m: portalMemberId, agora, max: MAX_TENTATIVAS_SYNC }) as LinhaJob[];
    for (const o of orfaos) {
      db.prepare(
        `UPDATE sync_job SET estado = 'falha_manual', lease_ate = NULL,
                ultimo_erro = 'lease expirado na ultima tentativa', atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id`,
      ).run({ m: portalMemberId, id: o.id, agora });
      espelharNoPedido(portalMemberId, o.pedido_id, o.operacao, "falha_manual");
    }
    const alvo = db
      .prepare(
        `SELECT j.id FROM sync_job j
          WHERE j.portal_member_id = @m
            AND (@so IS NULL OR j.pedido_id = @so)
            AND j.tentativas < @max
            AND (
              (j.estado IN ('pendente', 'falha') AND (j.proxima_em IS NULL OR j.proxima_em <= @agora))
              OR (j.operacao <> 'adicionar' AND j.estado = 'em_andamento' AND j.lease_ate <= @agora)
            )
            AND NOT EXISTS (
              SELECT 1 FROM sync_job o
               WHERE o.portal_member_id = j.portal_member_id AND o.pedido_id = j.pedido_id
                 AND o.id <> j.id AND o.estado = 'em_andamento' AND o.lease_ate > @agora)
            AND (j.operacao = 'adicionar' OR NOT EXISTS (
              SELECT 1 FROM sync_job a
               WHERE a.portal_member_id = j.portal_member_id AND a.pedido_id = j.pedido_id
                 AND a.operacao = 'adicionar' AND (a.estado NOT IN ('ok', 'falha_manual')
                   OR a.ultimo_erro = @incerto)))
            AND (j.operacao <> 'adicionar' OR EXISTS (
              SELECT 1 FROM pedido p
               WHERE p.portal_member_id = j.portal_member_id AND p.id = j.pedido_id
                 AND p.status = 'aprovada'))
          ORDER BY j.id
          LIMIT 1`,
      )
      .get({ m: portalMemberId, agora, max: MAX_TENTATIVAS_SYNC, incerto: ADD_INCERTO, so: soPedidoId ?? null }) as { id: number } | undefined;
    if (!alvo) return null;

    const r = db
      .prepare(
        `UPDATE sync_job
            SET estado = 'em_andamento', tentativas = tentativas + 1,
                geracao = geracao + 1,
                lease_ate = @lease, atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id
            AND estado IN ('pendente', 'falha', 'em_andamento')`,
      )
      .run({ m: portalMemberId, id: alvo.id, lease: leaseAte, agora });
    if (r.changes !== 1) return null;

    const linha = db
      .prepare("SELECT * FROM sync_job WHERE portal_member_id = ? AND id = ?")
      .get(portalMemberId, alvo.id) as LinhaJob;
    espelharNoPedido(portalMemberId, linha.pedido_id, linha.operacao, "em_andamento");
    return paraJob(linha);
  });
}

/** Marca o job como concluido e espelha `ok` (adicionar) ou `removido` (remover). */
export function concluirJob(
  portalMemberId: string,
  jobId: number,
  agora: InstanteISO,
  resultado: { bitrixEventId?: string; ownerId?: number; secao?: number } | undefined,
  geracao: number,
): void {
  exigirPortal(portalMemberId);
  exigirGeracao(geracao);
  emTransacao(() => {
    const job = obterJob(portalMemberId, jobId);
    if (!job) throw new ErroDominio("NAO_ENCONTRADO", `sync_job ${jobId} inexistente`);
    const r = conexao()
      .prepare(
        `UPDATE sync_job SET estado = 'ok', lease_ate = NULL, proxima_em = NULL,
                ultimo_erro = NULL, atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id AND estado = 'em_andamento' ${FENCING}`,
      )
      .run({ m: portalMemberId, id: jobId, agora, ger: geracao });
    if (r.changes !== 1) throw erroTentativaAntiga(jobId);
    if (job.operacao === "adicionar" && resultado?.bitrixEventId) {
      // Preserva o ID mesmo se houve cancelamento durante a chamada remota.
      conexao().prepare(`UPDATE pedido SET bitrix_event_id = @evento,
        owner_id = COALESCE(@owner, owner_id), secao = COALESCE(@secao, secao)
        WHERE portal_member_id = @m AND id = @id`).run({
        m: portalMemberId, id: job.pedidoId, evento: resultado.bitrixEventId,
        owner: resultado.ownerId ?? null, secao: resultado.secao ?? null,
      });
    }
    espelharNoPedido(
      portalMemberId,
      job.pedidoId,
      job.operacao,
      job.operacao === "adicionar" ? "ok" : "removido",
      resultado,
    );
  });
}

/**
 * Registra a falha. Com tentativas < 3 o job volta a `falha` (elegivel em
 * `proximaEm`; omitido = imediato). Na 3a falha vira `falha_manual`.
 */
export function falharJob(
  portalMemberId: string,
  jobId: number,
  erro: string,
  agora: InstanteISO,
  proximaEm: InstanteISO | undefined,
  geracao: number,
): EstadoJob {
  exigirPortal(portalMemberId);
  exigirGeracao(geracao);
  return emTransacao(() => {
    const job = obterJob(portalMemberId, jobId);
    if (!job) throw new ErroDominio("NAO_ENCONTRADO", `sync_job ${jobId} inexistente`);
    const manual = job.tentativas >= MAX_TENTATIVAS_SYNC;
    const novo: EstadoJob = manual ? "falha_manual" : "falha";
    const r = conexao()
      .prepare(
        `UPDATE sync_job SET estado = @estado, lease_ate = NULL, proxima_em = @prox,
                ultimo_erro = @erro, atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id AND estado = 'em_andamento' ${FENCING}`,
      )
      .run({
        m: portalMemberId,
        id: jobId,
        estado: novo,
        prox: manual ? null : (proximaEm ?? null),
        erro: limparErro(erro),
        agora,
        ger: geracao,
      });
    if (r.changes !== 1) throw erroTentativaAntiga(jobId);
    espelharNoPedido(portalMemberId, job.pedidoId, job.operacao, novo);
    return novo;
  });
}

/**
 * Encerra o job em `falha_manual` de uma vez: erro permanente (ex.: pessoa sem
 * usuario do Bitrix, escrita bloqueada) ou tentativas esgotadas pelo executor.
 * `tentativas` e o total acumulado devolvido pelo executor (nunca diminui).
 */
export function esgotarJob(
  portalMemberId: string,
  jobId: number,
  erro: string,
  agora: InstanteISO,
  tentativas: number,
  geracao: number,
): void {
  exigirPortal(portalMemberId);
  exigirGeracao(geracao);
  emTransacao(() => {
    const job = obterJob(portalMemberId, jobId);
    if (!job) throw new ErroDominio("NAO_ENCONTRADO", `sync_job ${jobId} inexistente`);
    const r = conexao()
      .prepare(
        `UPDATE sync_job SET estado = 'falha_manual', lease_ate = NULL, proxima_em = NULL,
                tentativas = MAX(tentativas, @tent), ultimo_erro = @erro, atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id AND estado = 'em_andamento' ${FENCING}`,
      )
      .run({
        m: portalMemberId,
        id: jobId,
        tent: Math.max(0, Math.trunc(tentativas)),
        erro: limparErro(erro),
        agora,
        ger: geracao,
      });
    if (r.changes !== 1) throw erroTentativaAntiga(jobId);
    espelharNoPedido(portalMemberId, job.pedidoId, job.operacao, "falha_manual");
  });
}

/** Resultado de add incerto: bloqueia retomada e remocao conclusiva. */
export function registrarAddIncerto(portalMemberId: string, jobId: number, agora: InstanteISO, geracao: number): void {
  exigirPortal(portalMemberId);
  exigirGeracao(geracao);
  emTransacao(() => {
    const job = obterJob(portalMemberId, jobId);
    if (!job || job.operacao !== "adicionar" || job.estado !== "em_andamento" || job.geracao !== geracao) {
      throw erroTentativaAntiga(jobId);
    }
    conexao().prepare(`UPDATE sync_job SET estado = 'falha_manual', lease_ate = NULL,
      proxima_em = NULL, ultimo_erro = @erro, atualizado_em = @agora
      WHERE portal_member_id = @m AND id = @id`).run({ m: portalMemberId, id: jobId, erro: ADD_INCERTO, agora });
    conexao().prepare(`UPDATE pedido SET sincronizacao = 'falha_manual'
      WHERE portal_member_id = @m AND id = @id`).run({ m: portalMemberId, id: job.pedidoId });
  });
}

/**
 * Acao do admin ("Reprocessar"): reabre jobs em `falha`/`falha_manual` com
 * tentativas zeradas. Devolve quantos jobs foram reabertos.
 *
 * NAO reabre criacao de pedido que ja nao esta aprovado (cancelado): esse job
 * e descartado, porque reabri-lo criaria uma ausencia fantasma no Bitrix.
 */
export function reprocessarJobs(
  portalMemberId: string,
  agora: InstanteISO,
  pedidoId?: number,
): number {
  exigirPortal(portalMemberId);
  return emTransacao(() => {
    const db = conexao();
    descartarCriacoesObsoletas(db, portalMemberId, agora, pedidoId);
    const jobs = db
      .prepare(
        `SELECT * FROM sync_job
          WHERE portal_member_id = @m AND estado IN ('falha', 'falha_manual')
            AND (@pedido IS NULL OR pedido_id = @pedido)
            AND (operacao <> 'adicionar' OR (${AINDA_APROVADO} AND COALESCE(ultimo_erro, '') <> @incerto))`,
      )
      .all({ m: portalMemberId, pedido: pedidoId ?? null, incerto: ADD_INCERTO }) as LinhaJob[];
    for (const j of jobs) {
      db.prepare(
        `UPDATE sync_job SET estado = 'pendente', tentativas = 0, proxima_em = NULL,
                lease_ate = NULL, atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id`,
      ).run({ m: portalMemberId, id: j.id, agora });
      espelharNoPedido(
        portalMemberId,
        j.pedido_id,
        j.operacao,
        j.operacao === "adicionar" ? "pendente" : "remocao_pendente",
      );
    }
    return jobs.length;
  });
}

/** Log para Configuracoes -> Bitrix24 (mais recente primeiro). */
export function listarLogSincronizacao(
  portalMemberId: string,
  limite = 100,
): SincronizacaoLogVisao[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT * FROM sync_job WHERE portal_member_id = ?
        ORDER BY atualizado_em DESC, id DESC LIMIT ?`,
    )
    .all(portalMemberId, Math.max(1, Math.min(500, Math.trunc(limite)))) as LinhaJob[];
  return linhas.map((r) => {
    const v: SincronizacaoLogVisao = {
      pedidoId: r.pedido_id,
      operacao: r.operacao,
      estado: r.estado,
      tentativas: r.tentativas,
      quando: r.atualizado_em,
    };
    if (r.ultimo_erro !== null) v.erro = r.ultimo_erro;
    return v;
  });
}
