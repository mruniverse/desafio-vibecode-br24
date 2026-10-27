/**
 * Repositorio da fila de sincronizacao (tabela sync_job, migracao 003).
 *
 * Fluxo: aprovar -> job `adicionar`; cancelar aprovada -> job `remover`.
 * O consumidor (C3) chama `tomarProximoJob` -> executa -> `concluirJob` ou
 * `falharJob`. Ate 3 tentativas; depois `falha_manual` (acao do admin via
 * `reprocessarJobs`). Jobs do mesmo pedido sao SERIAIS: nenhum job e tomado
 * enquanto outro do mesmo pedido tem lease valido, e `remover` so roda depois
 * que `adicionar` terminou (ok ou falha_manual).
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
 * processos nunca recebem o mesmo job: a selecao e o UPDATE ocorrem na mesma
 * transacao IMEDIATA. Job com lease vencido e retomado.
 */
export function tomarProximoJob(
  portalMemberId: string,
  agora: InstanteISO,
  leaseAte: InstanteISO,
): SyncJob | null {
  exigirPortal(portalMemberId);
  return emTransacao(() => {
    const db = conexao();
    // Lease vencido sem tentativas restantes: nao fica preso para sempre.
    const orfaos = db
      .prepare(
        `SELECT * FROM sync_job
          WHERE portal_member_id = @m AND estado = 'em_andamento'
            AND lease_ate <= @agora AND tentativas >= @max`,
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
            AND j.tentativas < @max
            AND (
              (j.estado IN ('pendente', 'falha') AND (j.proxima_em IS NULL OR j.proxima_em <= @agora))
              OR (j.estado = 'em_andamento' AND j.lease_ate <= @agora)
            )
            AND NOT EXISTS (
              SELECT 1 FROM sync_job o
               WHERE o.portal_member_id = j.portal_member_id AND o.pedido_id = j.pedido_id
                 AND o.id <> j.id AND o.estado = 'em_andamento' AND o.lease_ate > @agora)
            AND (j.operacao = 'adicionar' OR NOT EXISTS (
              SELECT 1 FROM sync_job a
               WHERE a.portal_member_id = j.portal_member_id AND a.pedido_id = j.pedido_id
                 AND a.operacao = 'adicionar' AND a.estado NOT IN ('ok', 'falha_manual')))
          ORDER BY j.id
          LIMIT 1`,
      )
      .get({ m: portalMemberId, agora, max: MAX_TENTATIVAS_SYNC }) as { id: number } | undefined;
    if (!alvo) return null;

    const r = db
      .prepare(
        `UPDATE sync_job
            SET estado = 'em_andamento', tentativas = tentativas + 1,
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
  resultado?: { bitrixEventId?: string; ownerId?: number; secao?: number },
): void {
  exigirPortal(portalMemberId);
  emTransacao(() => {
    const job = obterJob(portalMemberId, jobId);
    if (!job) throw new ErroDominio("NAO_ENCONTRADO", `sync_job ${jobId} inexistente`);
    const r = conexao()
      .prepare(
        `UPDATE sync_job SET estado = 'ok', lease_ate = NULL, proxima_em = NULL,
                ultimo_erro = NULL, atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id AND estado = 'em_andamento'`,
      )
      .run({ m: portalMemberId, id: jobId, agora });
    if (r.changes !== 1) {
      throw new ErroDominio("TRANSICAO_INVALIDA", `sync_job ${jobId} nao esta em andamento`);
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
  proximaEm?: InstanteISO,
): EstadoJob {
  exigirPortal(portalMemberId);
  return emTransacao(() => {
    const job = obterJob(portalMemberId, jobId);
    if (!job) throw new ErroDominio("NAO_ENCONTRADO", `sync_job ${jobId} inexistente`);
    const manual = job.tentativas >= MAX_TENTATIVAS_SYNC;
    const novo: EstadoJob = manual ? "falha_manual" : "falha";
    const r = conexao()
      .prepare(
        `UPDATE sync_job SET estado = @estado, lease_ate = NULL, proxima_em = @prox,
                ultimo_erro = @erro, atualizado_em = @agora
          WHERE portal_member_id = @m AND id = @id AND estado = 'em_andamento'`,
      )
      .run({
        m: portalMemberId,
        id: jobId,
        estado: novo,
        prox: manual ? null : (proximaEm ?? null),
        erro: limparErro(erro),
        agora,
      });
    if (r.changes !== 1) {
      throw new ErroDominio("TRANSICAO_INVALIDA", `sync_job ${jobId} nao esta em andamento`);
    }
    espelharNoPedido(portalMemberId, job.pedidoId, job.operacao, novo);
    return novo;
  });
}

/**
 * Acao do admin ("Reprocessar"): reabre jobs em `falha`/`falha_manual` com
 * tentativas zeradas. Devolve quantos jobs foram reabertos.
 */
export function reprocessarJobs(
  portalMemberId: string,
  agora: InstanteISO,
  pedidoId?: number,
): number {
  exigirPortal(portalMemberId);
  return emTransacao(() => {
    const db = conexao();
    const jobs = db
      .prepare(
        `SELECT * FROM sync_job
          WHERE portal_member_id = @m AND estado IN ('falha', 'falha_manual')
            AND (@pedido IS NULL OR pedido_id = @pedido)`,
      )
      .all({ m: portalMemberId, pedido: pedidoId ?? null }) as LinhaJob[];
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
