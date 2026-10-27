/**
 * Repositorio de notificacoes (caixa do app) e auditoria.
 */
import type { InstanteISO } from "../tipos";
import type { NotificacaoVisao } from "../visoes";
import { conexao, exigirPortal } from "./base";

// ---------------------------------------------------------------------------
// Notificacoes
// ---------------------------------------------------------------------------

/**
 * Grava na caixa da pessoa. UNICA por (pessoa, pedido, etapa): repetir devolve
 * false e nao duplica (idempotencia de "Lembrar gestor" e de reenvio).
 * `texto` ja deve vir renderizado com a whitelist (sem motivo/justificativa).
 */
export function gravarNotificacao(
  portalMemberId: string,
  e: { pessoaId: string; pedidoId: number; etapa: string; texto: string; criadaEm: InstanteISO },
): boolean {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare(
      `INSERT INTO notificacao (portal_member_id, pessoa_id, pedido_id, etapa, texto, criada_em)
       VALUES (@m, @pessoa, @pedido, @etapa, @texto, @em)
       ON CONFLICT (portal_member_id, pessoa_id, pedido_id, etapa) DO NOTHING`,
    )
    .run({
      m: portalMemberId,
      pessoa: e.pessoaId,
      pedido: e.pedidoId,
      etapa: e.etapa,
      texto: e.texto,
      em: e.criadaEm,
    });
  return r.changes === 1;
}

/** So a caixa da PROPRIA pessoa (nao existe leitura da caixa alheia). */
export function listarNotificacoes(
  portalMemberId: string,
  pessoaId: string,
  limite = 100,
): NotificacaoVisao[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT id, pedido_id, etapa, texto, criada_em, lida FROM notificacao
        WHERE portal_member_id = ? AND pessoa_id = ?
        ORDER BY criada_em DESC, id DESC LIMIT ?`,
    )
    .all(portalMemberId, pessoaId, Math.max(1, Math.min(500, Math.trunc(limite)))) as {
    id: number;
    pedido_id: number;
    etapa: string;
    texto: string;
    criada_em: string;
    lida: number;
  }[];
  return linhas.map((r) => ({
    id: r.id,
    pedidoId: r.pedido_id,
    etapa: r.etapa,
    texto: r.texto,
    criadaEm: r.criada_em,
    lida: r.lida === 1,
  }));
}

/** Marca como lida SO se a notificacao for da pessoa informada. */
export function marcarNotificacaoLida(
  portalMemberId: string,
  pessoaId: string,
  notificacaoId: number,
): boolean {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare(
      `UPDATE notificacao SET lida = 1
        WHERE portal_member_id = ? AND pessoa_id = ? AND id = ?`,
    )
    .run(portalMemberId, pessoaId, notificacaoId);
  return r.changes === 1;
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

const CHAVE_PROIBIDA = /motiv|justific|senha|password|token|secret|webhook|authorization/i;

/** Copia o objeto trocando por "[omitido]" qualquer chave que possa carregar texto livre/segredo. */
function mascarar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 4) return "[omitido]";
  if (Array.isArray(valor)) return valor.map((v) => mascarar(v, profundidade + 1));
  if (valor !== null && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = CHAVE_PROIBIDA.test(k) ? "[omitido]" : mascarar(v, profundidade + 1);
    }
    return saida;
  }
  return valor;
}

export interface EntradaAuditoria {
  em: InstanteISO;
  atorId?: string;
  acao: string;
  entidade: string;
  entidadeId?: string | number;
  /** Metadados (ids, status, contagens). Chaves de motivo, justificativa e token sao omitidas. */
  detalhe?: Record<string, unknown>;
}

export interface RegistroAuditoria {
  id: number;
  em: InstanteISO;
  atorId?: string;
  acao: string;
  entidade: string;
  entidadeId?: string;
  detalhe?: Record<string, unknown>;
}

export function registrarAuditoria(portalMemberId: string, e: EntradaAuditoria): void {
  exigirPortal(portalMemberId);
  conexao()
    .prepare(
      `INSERT INTO auditoria (portal_member_id, em, ator_id, acao, entidade, entidade_id, detalhe)
       VALUES (@m, @em, @ator, @acao, @entidade, @eid, @detalhe)`,
    )
    .run({
      m: portalMemberId,
      em: e.em,
      ator: e.atorId ?? null,
      acao: e.acao,
      entidade: e.entidade,
      eid: e.entidadeId === undefined ? null : String(e.entidadeId),
      detalhe: e.detalhe ? JSON.stringify(mascarar(e.detalhe)) : null,
    });
}

export function listarAuditoria(
  portalMemberId: string,
  filtro: { entidade?: string; entidadeId?: string | number; limite?: number } = {},
): RegistroAuditoria[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT * FROM auditoria
        WHERE portal_member_id = @m
          AND (@entidade IS NULL OR entidade = @entidade)
          AND (@eid IS NULL OR entidade_id = @eid)
        ORDER BY em DESC, id DESC LIMIT @limite`,
    )
    .all({
      m: portalMemberId,
      entidade: filtro.entidade ?? null,
      eid: filtro.entidadeId === undefined ? null : String(filtro.entidadeId),
      limite: Math.max(1, Math.min(1000, Math.trunc(filtro.limite ?? 200))),
    }) as {
    id: number;
    em: string;
    ator_id: string | null;
    acao: string;
    entidade: string;
    entidade_id: string | null;
    detalhe: string | null;
  }[];
  return linhas.map((r) => {
    const a: RegistroAuditoria = { id: r.id, em: r.em, acao: r.acao, entidade: r.entidade };
    if (r.ator_id !== null) a.atorId = r.ator_id;
    if (r.entidade_id !== null) a.entidadeId = r.entidade_id;
    if (r.detalhe !== null) a.detalhe = JSON.parse(r.detalhe) as Record<string, unknown>;
    return a;
  });
}
