/**
 * Repositorio de lancamentos de saldo (credito/ajuste). O debito e DERIVADO
 * dos pedidos (ver pedidos.listarDebitosDaPessoa); nao ha linha de debito.
 */
import { ErroDominio } from "../erros";
import type { Carteira, DataISO, InstanteISO, Lancamento, SessaoDemo } from "../tipos";
import {
  conexao,
  ehViolacaoCheck,
  ehViolacaoFk,
  emTransacao,
  exigirPortal,
  paramsEscopo,
  sqlEscopoPessoa,
} from "./base";

interface LinhaLancamento {
  id: number;
  pessoa_id: string;
  ano: number;
  carteira: Carteira;
  tipo: "credito" | "ajuste";
  dias: number;
  motivo: string;
  vence_em: string | null;
  criado_por: string;
  criado_em: string;
}

function paraLancamento(r: LinhaLancamento): Lancamento {
  const l: Lancamento = {
    id: r.id,
    pessoaId: r.pessoa_id,
    ano: r.ano,
    carteira: r.carteira,
    tipo: r.tipo,
    dias: r.dias,
    motivo: r.motivo,
    criadoPor: r.criado_por,
    criadoEm: r.criado_em,
  };
  if (r.vence_em !== null) l.venceEm = r.vence_em;
  return l;
}

export interface NovoLancamento {
  pessoaId: string;
  ano: number;
  carteira: Carteira;
  tipo: "credito" | "ajuste";
  dias: number;
  motivo: string;
  venceEm?: DataISO;
  criadoPor: string;
  criadoEm: InstanteISO;
}

/**
 * Registra credito/ajuste. Quem pode creditar (nunca a si mesmo; gestor so a
 * equipe) e regra do servico; aqui so se impede `criadoPor === pessoaId`
 * como defesa em profundidade.
 */
export function criarLancamento(portalMemberId: string, e: NovoLancamento): Lancamento {
  exigirPortal(portalMemberId);
  if (e.criadoPor === e.pessoaId) {
    throw new ErroDominio("SEM_PERMISSAO", "ninguem credita dias para si mesmo");
  }
  return emTransacao(() => {
    try {
      const r = conexao()
        .prepare(
          `INSERT INTO lancamento (portal_member_id, pessoa_id, ano, carteira, tipo, dias, motivo,
                                   vence_em, criado_por, criado_em, origem)
           VALUES (@m, @pessoa, @ano, @carteira, @tipo, @dias, @motivo, @vence, @por, @em, 'app')`,
        )
        .run({
          m: portalMemberId,
          pessoa: e.pessoaId,
          ano: e.ano,
          carteira: e.carteira,
          tipo: e.tipo,
          dias: e.dias,
          motivo: e.motivo,
          vence: e.venceEm ?? null,
          por: e.criadoPor,
          em: e.criadoEm,
        });
      const linha = conexao()
        .prepare("SELECT * FROM lancamento WHERE portal_member_id = ? AND id = ?")
        .get(portalMemberId, Number(r.lastInsertRowid)) as LinhaLancamento;
      return paraLancamento(linha);
    } catch (err) {
      if (ehViolacaoFk(err)) {
        throw new ErroDominio("NAO_ENCONTRADO", "pessoa inexistente neste portal");
      }
      if (ehViolacaoCheck(err)) {
        throw new ErroDominio("NUMERO_INVALIDO", "lancamento viola as restricoes (dias/ano)");
      }
      throw err;
    }
  });
}

/**
 * Lancamentos de uma pessoa SE ela estiver no escopo da sessao (proprio /
 * equipes do gestor / todos). Fora do escopo => lista vazia.
 */
export function listarLancamentosVisiveis(
  portalMemberId: string,
  sessao: SessaoDemo,
  pessoaId: string,
): Lancamento[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT l.* FROM lancamento l
        WHERE l.portal_member_id = @m AND l.pessoa_id = @alvo AND ${sqlEscopoPessoa("l.pessoa_id")}
        ORDER BY l.criado_em DESC, l.id DESC`,
    )
    .all({ ...paramsEscopo(portalMemberId, sessao), alvo: pessoaId }) as LinhaLancamento[];
  return linhas.map(paraLancamento);
}

/** SEM escopo (servico ja autorizou): base do calculo de saldo. */
export function lancamentosDaPessoa(portalMemberId: string, pessoaId: string): Lancamento[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT * FROM lancamento WHERE portal_member_id = ? AND pessoa_id = ?
        ORDER BY ano, vence_em, id`,
    )
    .all(portalMemberId, pessoaId) as LinhaLancamento[];
  return linhas.map(paraLancamento);
}

/** SEM escopo: lancamentos de todos os membros de uma equipe (Painel: ferias vencendo). */
export function lancamentosDaEquipe(portalMemberId: string, equipeId: string): Lancamento[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT l.* FROM lancamento l
         JOIN pessoa q ON q.portal_member_id = l.portal_member_id AND q.id = l.pessoa_id
        WHERE l.portal_member_id = ? AND q.equipe_id = ?
        ORDER BY l.pessoa_id, l.ano, l.vence_em, l.id`,
    )
    .all(portalMemberId, equipeId) as LinhaLancamento[];
  return linhas.map(paraLancamento);
}
