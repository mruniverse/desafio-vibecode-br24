/**
 * Repositorio de pedidos (tabelas pedido e pedido_dia).
 *
 * - `motivoPrivado` e CIFRADO em repouso (coluna motivo_privado_enc) e so sai
 *   decifrado para o dono do pedido ou admin (lido do banco) — ou quando um
 *   servico pede explicitamente `comMotivoPrivado` numa leitura SEM escopo.
 * - Sobreposicao: `pedido_dia` tem UNIQUE(portal_member_id, pessoa_id, dia);
 *   a insercao dentro da transacao IMEDIATA e a defesa final (1 vencedor).
 * - Decisao atomica: UPDATE ... WHERE id=? AND status='pendente' [AND versao=?]
 *   exigindo changes===1.
 * - Debito de saldo e DERIVADO destes pedidos (diasDebitoPorAno); nao ha
 *   lancamento de debito.
 */
import { decrypt, encrypt } from "@/lib/crypto";
import { ErroDominio } from "../erros";
import type {
  Carteira,
  DataISO,
  InstanteISO,
  Pedido,
  SessaoDemo,
  StatusPedido,
  StatusSincronizacao,
} from "../tipos";
import {
  conexao,
  ehViolacaoCheck,
  ehViolacaoFk,
  ehViolacaoUnica,
  emTransacao,
  exigirPortal,
  papelNoBanco,
  paramsEscopo,
  sqlEscopoPessoa,
} from "./base";
import { enfileirarJob } from "./sync";

const LIMITE_PADRAO = 500;

interface LinhaPedido {
  id: number;
  pessoa_id: string;
  tipo_id: string;
  inicio: string;
  fim: string;
  dias_uteis: number;
  dias_debito_por_ano: string;
  status: StatusPedido;
  sincronizacao: StatusSincronizacao;
  justificativa: string | null;
  motivo_privado_enc: string | null;
  excede_saldo: number;
  motivo_decisao: string | null;
  sugestao_inicio: string | null;
  sugestao_fim: string | null;
  prazo_em: string | null;
  criado_em: string;
  decidido_por: string | null;
  decidido_em: string | null;
  cancelado_em: string | null;
  cancelado_por: string | null;
  bitrix_event_id: string | null;
  owner_id: number | null;
  secao: number | null;
  versao: number;
}

function paraPedido(r: LinhaPedido, mostrarMotivoPrivado: boolean): Pedido {
  const p: Pedido = {
    id: r.id,
    pessoaId: r.pessoa_id,
    tipoId: r.tipo_id,
    inicio: r.inicio,
    fim: r.fim,
    diasUteis: r.dias_uteis,
    diasDebitoPorAno: JSON.parse(r.dias_debito_por_ano) as Record<string, number>,
    status: r.status,
    sincronizacao: r.sincronizacao,
    excedeSaldo: r.excede_saldo === 1,
    criadoEm: r.criado_em,
    versao: r.versao,
  };
  if (r.justificativa !== null) p.justificativa = r.justificativa;
  if (mostrarMotivoPrivado && r.motivo_privado_enc !== null) {
    p.motivoPrivado = decrypt(r.motivo_privado_enc);
  }
  if (r.motivo_decisao !== null) p.motivoDecisao = r.motivo_decisao;
  if (r.sugestao_inicio !== null && r.sugestao_fim !== null) {
    p.sugestao = { inicio: r.sugestao_inicio, fim: r.sugestao_fim };
  }
  if (r.prazo_em !== null) p.prazoEm = r.prazo_em;
  if (r.decidido_por !== null) p.decididoPor = r.decidido_por;
  if (r.decidido_em !== null) p.decididoEm = r.decidido_em;
  if (r.cancelado_em !== null) p.canceladoEm = r.cancelado_em;
  if (r.cancelado_por !== null) p.canceladoPor = r.cancelado_por;
  if (r.bitrix_event_id !== null) p.bitrixEventId = r.bitrix_event_id;
  if (r.owner_id !== null) p.ownerId = r.owner_id;
  if (r.secao !== null) p.secao = r.secao;
  return p;
}

/** Mapeia linhas de uma listagem sob a sessao: motivo so para dono/admin (papel do banco). */
function mapearParaSessao(
  portalMemberId: string,
  sessao: SessaoDemo,
  linhas: LinhaPedido[],
): Pedido[] {
  const papel = papelNoBanco(portalMemberId, sessao.pessoaId);
  return linhas.map((r) =>
    paraPedido(r, papel === "admin" || r.pessoa_id === sessao.pessoaId),
  );
}

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------

export interface NovoPedido {
  pessoaId: string;
  tipoId: string;
  inicio: DataISO;
  fim: DataISO;
  /** Calculado pelo servidor (dominio). */
  diasUteis: number;
  diasDebitoPorAno: Record<string, number>;
  /** Dias UTEIS do periodo (entram em pedido_dia). */
  diasOcupados: DataISO[];
  justificativa?: string;
  /** Texto puro AQUI; o repositorio cifra antes de gravar. */
  motivoPrivado?: string;
  excedeSaldo: boolean;
  prazoEm?: InstanteISO;
  criadoEm: InstanteISO;
  origem?: "app" | "seed";
}

/**
 * Cria o pedido `pendente` e ocupa os dias em pedido_dia na mesma transacao.
 * Sobreposicao com outro pedido pendente|aprovado da pessoa => SOBREPOSICAO
 * (nada e gravado). Tipo sensivel rejeita `justificativa`; tipo comum rejeita
 * `motivoPrivado`.
 */
export function criarPedido(portalMemberId: string, e: NovoPedido): Pedido {
  exigirPortal(portalMemberId);
  return emTransacao(() => {
    const db = conexao();
    const tipo = db
      .prepare("SELECT sensivel FROM tipo WHERE portal_member_id = ? AND id = ?")
      .get(portalMemberId, e.tipoId) as { sensivel: number } | undefined;
    if (!tipo) throw new ErroDominio("NAO_ENCONTRADO", `tipo ${e.tipoId} inexistente`);
    if (tipo.sensivel === 1 && e.justificativa !== undefined) {
      throw new ErroDominio("TIPO_SENSIVEL", "tipo sensivel nao aceita justificativa");
    }
    if (tipo.sensivel === 0 && e.motivoPrivado !== undefined) {
      throw new ErroDominio("TIPO_SENSIVEL", "tipo comum nao aceita motivoPrivado");
    }
    for (const d of e.diasOcupados) {
      if (d < e.inicio || d > e.fim) {
        throw new ErroDominio("DATA_INVALIDA", "dia ocupado fora do periodo do pedido");
      }
    }

    let id: number;
    try {
      const r = db
        .prepare(
          `INSERT INTO pedido (portal_member_id, pessoa_id, tipo_id, inicio, fim, dias_uteis,
                               dias_debito_por_ano, status, sincronizacao, justificativa,
                               motivo_privado_enc, excede_saldo, prazo_em, criado_em, versao, origem)
           VALUES (@m, @pessoa, @tipo, @inicio, @fim, @dias, @ddpa, 'pendente', 'nao_aplicavel',
                   @just, @motivo, @exc, @prazo, @criado, 0, @origem)`,
        )
        .run({
          m: portalMemberId,
          pessoa: e.pessoaId,
          tipo: e.tipoId,
          inicio: e.inicio,
          fim: e.fim,
          dias: e.diasUteis,
          ddpa: JSON.stringify(e.diasDebitoPorAno),
          just: e.justificativa ?? null,
          motivo: e.motivoPrivado !== undefined ? encrypt(e.motivoPrivado) : null,
          exc: e.excedeSaldo ? 1 : 0,
          prazo: e.prazoEm ?? null,
          criado: e.criadoEm,
          origem: e.origem ?? "app",
        });
      id = Number(r.lastInsertRowid);
    } catch (err) {
      if (ehViolacaoFk(err)) {
        throw new ErroDominio("NAO_ENCONTRADO", "pessoa ou tipo inexistente neste portal");
      }
      if (ehViolacaoCheck(err)) {
        throw new ErroDominio("INTERVALO_INVALIDO", "dados do pedido violam as restricoes");
      }
      throw err;
    }
    ocuparDias(portalMemberId, id, e.pessoaId, e.diasOcupados);
    return lerPedidoInterno(portalMemberId, id) as Pedido;
  });
}

/** Insere os dias; UNIQUE(portal, pessoa, dia) violada => SOBREPOSICAO. */
function ocuparDias(
  portalMemberId: string,
  pedidoId: number,
  pessoaId: string,
  dias: DataISO[],
): void {
  const ins = conexao().prepare(
    `INSERT INTO pedido_dia (portal_member_id, pessoa_id, dia, pedido_id) VALUES (?, ?, ?, ?)`,
  );
  for (const dia of dias) {
    try {
      ins.run(portalMemberId, pessoaId, dia, pedidoId);
    } catch (err) {
      if (ehViolacaoUnica(err)) {
        throw new ErroDominio("SOBREPOSICAO", `dia ${dia} ja ocupado por outro pedido da pessoa`);
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Leitura SEM escopo (o servico ja autorizou). `comMotivoPrivado` decifra o
 * motivo — so use para dono/admin.
 */
export function lerPedidoInterno(
  portalMemberId: string,
  pedidoId: number,
  opcoes?: { comMotivoPrivado?: boolean },
): Pedido | null {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare("SELECT * FROM pedido WHERE portal_member_id = ? AND id = ?")
    .get(portalMemberId, pedidoId) as LinhaPedido | undefined;
  return r ? paraPedido(r, opcoes?.comMotivoPrivado === true) : null;
}

/** Um pedido SE estiver no escopo da sessao (senao null => 404 na rota). */
export function lerPedidoVisivel(
  portalMemberId: string,
  sessao: SessaoDemo,
  pedidoId: number,
): Pedido | null {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare(
      `SELECT p.* FROM pedido p
        WHERE p.portal_member_id = @m AND p.id = @id AND ${sqlEscopoPessoa("p.pessoa_id")}`,
    )
    .get({ ...paramsEscopo(portalMemberId, sessao), id: pedidoId }) as LinhaPedido | undefined;
  return r ? mapearParaSessao(portalMemberId, sessao, [r])[0] : null;
}

export interface FiltroPedidos {
  status?: StatusPedido[];
  pessoaId?: string;
  equipeId?: string;
  /** Pedidos cujo periodo intersecta [de, ate]. */
  de?: DataISO;
  ate?: DataISO;
  limite?: number;
}

/** Listagem filtrada NO SQL pelo escopo da sessao (proprio / equipes do gestor / todos). */
export function listarPedidosVisiveis(
  portalMemberId: string,
  sessao: SessaoDemo,
  filtro: FiltroPedidos = {},
): Pedido[] {
  exigirPortal(portalMemberId);
  const where: string[] = ["p.portal_member_id = @m", sqlEscopoPessoa("p.pessoa_id")];
  const params: Record<string, string | number> = { ...paramsEscopo(portalMemberId, sessao) };

  if (filtro.status && filtro.status.length > 0) {
    const nomes = filtro.status.map((s, i) => {
      params[`st${i}`] = s;
      return `@st${i}`;
    });
    where.push(`p.status IN (${nomes.join(", ")})`);
  }
  if (filtro.pessoaId !== undefined) {
    where.push("p.pessoa_id = @fPessoa");
    params.fPessoa = filtro.pessoaId;
  }
  if (filtro.equipeId !== undefined) {
    where.push(
      `EXISTS (SELECT 1 FROM pessoa fp WHERE fp.portal_member_id = p.portal_member_id
                 AND fp.id = p.pessoa_id AND fp.equipe_id = @fEquipe)`,
    );
    params.fEquipe = filtro.equipeId;
  }
  if (filtro.de !== undefined) {
    where.push("p.fim >= @fDe");
    params.fDe = filtro.de;
  }
  if (filtro.ate !== undefined) {
    where.push("p.inicio <= @fAte");
    params.fAte = filtro.ate;
  }
  params.limite = Math.max(1, Math.min(2000, Math.trunc(filtro.limite ?? LIMITE_PADRAO)));

  const linhas = conexao()
    .prepare(
      `SELECT p.* FROM pedido p WHERE ${where.join(" AND ")}
        ORDER BY p.criado_em DESC, p.id DESC LIMIT @limite`,
    )
    .all(params) as LinhaPedido[];
  return mapearParaSessao(portalMemberId, sessao, linhas);
}

/**
 * Fila "Pedidos para aprovar": pendentes do escopo, nunca os proprios.
 * (Colaborador nao tem fila: o escopo dele so contem o que e dele.)
 */
export function listarPedidosParaAprovar(
  portalMemberId: string,
  sessao: SessaoDemo,
): Pedido[] {
  exigirPortal(portalMemberId);
  const papel = papelNoBanco(portalMemberId, sessao.pessoaId);
  if (papel !== "gestor" && papel !== "admin") return [];
  const linhas = conexao()
    .prepare(
      `SELECT p.* FROM pedido p
        WHERE p.portal_member_id = @m AND p.status = 'pendente' AND p.pessoa_id <> @sessao
          AND ${sqlEscopoPessoa("p.pessoa_id")}
        ORDER BY p.criado_em ASC, p.id ASC`,
    )
    .all(paramsEscopo(portalMemberId, sessao)) as LinhaPedido[];
  return mapearParaSessao(portalMemberId, sessao, linhas);
}

/**
 * SEM escopo (servico ja autorizou): pedidos de UMA pessoa, para saldo e
 * sobreposicao. Nunca devolve motivo privado.
 */
export function listarPedidosDaPessoa(
  portalMemberId: string,
  pessoaId: string,
  status?: StatusPedido[],
): Pedido[] {
  exigirPortal(portalMemberId);
  const lista = status && status.length > 0 ? status : (["pendente", "aprovada", "recusada", "cancelada"] as StatusPedido[]);
  const marcas = lista.map(() => "?").join(", ");
  const linhas = conexao()
    .prepare(
      `SELECT * FROM pedido WHERE portal_member_id = ? AND pessoa_id = ? AND status IN (${marcas})
        ORDER BY inicio, id`,
    )
    .all(portalMemberId, pessoaId, ...lista) as LinhaPedido[];
  return linhas.map((r) => paraPedido(r, false));
}

/** Pedido + carteira que consome (para o calculo de saldo). SEM escopo, sem motivo. */
export function listarDebitosDaPessoa(
  portalMemberId: string,
  pessoaId: string,
): { pedido: Pedido; carteira: Carteira }[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT p.*, t.consome_saldo AS carteira FROM pedido p
         JOIN tipo t ON t.portal_member_id = p.portal_member_id AND t.id = p.tipo_id
        WHERE p.portal_member_id = ? AND p.pessoa_id = ? AND t.consome_saldo IS NOT NULL
          AND p.status IN ('pendente', 'aprovada', 'cancelada')
        ORDER BY p.inicio, p.id`,
    )
    .all(portalMemberId, pessoaId) as (LinhaPedido & { carteira: Carteira })[];
  // Datas reais de consumo: pedido_dia (pendente/aprovada: todos os dias; cancelada: so os
  // anteriores a canceladoEm; recusada: nenhum). Nao depende do calendario de hoje.
  const dias = new Map<number, DataISO[]>();
  for (const d of conexao()
    .prepare("SELECT pedido_id, dia FROM pedido_dia WHERE portal_member_id = ? AND pessoa_id = ? ORDER BY dia")
    .all(portalMemberId, pessoaId) as { pedido_id: number; dia: string }[]) {
    const lista = dias.get(d.pedido_id);
    if (lista) lista.push(d.dia);
    else dias.set(d.pedido_id, [d.dia]);
  }
  return linhas.map((r) => {
    const pedido = paraPedido(r, false);
    pedido.diasOcupados = dias.get(r.id) ?? [];
    return { pedido, carteira: r.carteira };
  });
}

export interface AusenciaEquipe {
  pedidoId: number;
  pessoaId: string;
  tipoId: string;
  inicio: DataISO;
  fim: DataISO;
  status: StatusPedido;
  canceladoEm?: DataISO;
}

/**
 * Periodos de ausencia da equipe que intersectam [de, ate]: pendentes,
 * aprovados e cancelados que ja tinham comecado (contam ate canceladoEm-1).
 * SEM escopo e SEM justificativa/motivo; o mascaramento do tipo sensivel e da
 * camada de visao.
 */
export function listarAusenciasDaEquipe(
  portalMemberId: string,
  equipeId: string,
  de: DataISO,
  ate: DataISO,
): AusenciaEquipe[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT p.id, p.pessoa_id, p.tipo_id, p.inicio, p.fim, p.status, p.cancelado_em
         FROM pedido p
         JOIN pessoa q ON q.portal_member_id = p.portal_member_id AND q.id = p.pessoa_id
        WHERE p.portal_member_id = @m AND q.equipe_id = @equipe
          AND p.fim >= @de AND p.inicio <= @ate
          AND (p.status IN ('pendente', 'aprovada')
               OR (p.status = 'cancelada' AND p.cancelado_em > p.inicio))
        ORDER BY p.inicio, p.id`,
    )
    .all({ m: portalMemberId, equipe: equipeId, de, ate }) as {
    id: number;
    pessoa_id: string;
    tipo_id: string;
    inicio: string;
    fim: string;
    status: StatusPedido;
    cancelado_em: string | null;
  }[];
  return linhas.map((r) => {
    const a: AusenciaEquipe = {
      pedidoId: r.id,
      pessoaId: r.pessoa_id,
      tipoId: r.tipo_id,
      inicio: r.inicio,
      fim: r.fim,
      status: r.status,
    };
    if (r.cancelado_em !== null) a.canceladoEm = r.cancelado_em;
    return a;
  });
}

/**
 * Dias que o pedido realmente OCUPOU (pedido_dia) estritamente antes de `antesDe`,
 * em ordem. E a fonte do debito ja consumido no cancelamento: um feriado cadastrado
 * depois nao pode apagar nem mover dias que ja estavam ocupados.
 */
export function listarDiasOcupadosAntes(
  portalMemberId: string,
  pedidoId: number,
  antesDe: DataISO,
): DataISO[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT dia FROM pedido_dia
        WHERE portal_member_id = ? AND pedido_id = ? AND dia < ?
        ORDER BY dia`,
    )
    .all(portalMemberId, pedidoId, antesDe) as { dia: string }[];
  return linhas.map((l) => l.dia);
}

/** Dias uteis ocupados (pedido_dia) por membros da equipe, para cobertura. SEM escopo. */
export function listarDiasOcupadosDaEquipe(
  portalMemberId: string,
  equipeId: string,
  de: DataISO,
  ate: DataISO,
): { dia: DataISO; pessoaId: string; pedidoId: number; status: StatusPedido }[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare(
      `SELECT d.dia, d.pessoa_id, d.pedido_id, p.status
         FROM pedido_dia d
         JOIN pessoa q ON q.portal_member_id = d.portal_member_id AND q.id = d.pessoa_id
         JOIN pedido p ON p.portal_member_id = d.portal_member_id AND p.id = d.pedido_id
        WHERE d.portal_member_id = @m AND q.equipe_id = @equipe AND d.dia BETWEEN @de AND @ate
        ORDER BY d.dia, d.pessoa_id`,
    )
    .all({ m: portalMemberId, equipe: equipeId, de, ate }) as {
    dia: string;
    pessoa_id: string;
    pedido_id: number;
    status: StatusPedido;
  }[];
  return linhas.map((r) => ({
    dia: r.dia,
    pessoaId: r.pessoa_id,
    pedidoId: r.pedido_id,
    status: r.status,
  }));
}

// ---------------------------------------------------------------------------
// Decisao e cancelamento (atomicos)
// ---------------------------------------------------------------------------

export interface DecisaoPedido {
  pedidoId: number;
  /** Versao que o aprovador viu (controle otimista). */
  versao: number;
  decisao: "aprovar" | "recusar";
  decididoPor: string;
  decididoEm: InstanteISO;
  motivoDecisao?: string;
  /** Somente com recusa. */
  sugestao?: { inicio: DataISO; fim: DataISO };
  /** So na aprovacao: recalculo congelado novamente (diasUteis pode mudar). */
  recalculo?: {
    diasUteis: number;
    diasDebitoPorAno: Record<string, number>;
    excedeSaldo: boolean;
    diasOcupados: DataISO[];
  };
}

/**
 * Decide um pedido PENDENTE de forma atomica:
 *   UPDATE pedido ... WHERE id=? AND status='pendente' AND versao=? AND pessoa_id<>decididoPor
 * exigindo changes===1. Perdedor de corrida recebe TRANSICAO_INVALIDA e nada
 * muda. Aprovar enfileira o job `adicionar`; recusar libera pedido_dia.
 */
export function decidirPedido(portalMemberId: string, d: DecisaoPedido): Pedido {
  exigirPortal(portalMemberId);
  if (d.decisao === "recusar" && !d.motivoDecisao) {
    throw new ErroDominio("JUSTIFICATIVA_OBRIGATORIA", "recusa exige motivoDecisao");
  }
  if (d.sugestao && d.decisao !== "recusar") {
    throw new ErroDominio("INTERVALO_INVALIDO", "sugestao so com recusa");
  }
  if (d.recalculo && d.decisao !== "aprovar") {
    throw new ErroDominio("INTERVALO_INVALIDO", "recalculo so na aprovacao");
  }
  return emTransacao(() => {
    const db = conexao();
    const aprovar = d.decisao === "aprovar";
    const r = db
      .prepare(
        `UPDATE pedido
            SET status = @status, sincronizacao = @sinc,
                decidido_por = @por, decidido_em = @em, motivo_decisao = @motivo,
                sugestao_inicio = @si, sugestao_fim = @sf,
                dias_uteis = COALESCE(@dias, dias_uteis),
                dias_debito_por_ano = COALESCE(@ddpa, dias_debito_por_ano),
                excede_saldo = COALESCE(@exc, excede_saldo),
                versao = versao + 1
          WHERE portal_member_id = @m AND id = @id AND status = 'pendente'
            AND versao = @versao AND pessoa_id <> @por`,
      )
      .run({
        m: portalMemberId,
        id: d.pedidoId,
        versao: d.versao,
        status: aprovar ? "aprovada" : "recusada",
        sinc: aprovar ? "pendente" : "nao_aplicavel",
        por: d.decididoPor,
        em: d.decididoEm,
        motivo: d.motivoDecisao ?? null,
        si: d.sugestao?.inicio ?? null,
        sf: d.sugestao?.fim ?? null,
        dias: d.recalculo?.diasUteis ?? null,
        ddpa: d.recalculo ? JSON.stringify(d.recalculo.diasDebitoPorAno) : null,
        exc: d.recalculo ? (d.recalculo.excedeSaldo ? 1 : 0) : null,
      });

    if (r.changes !== 1) {
      const atual = db
        .prepare("SELECT pessoa_id, status, versao FROM pedido WHERE portal_member_id = ? AND id = ?")
        .get(portalMemberId, d.pedidoId) as
        | { pessoa_id: string; status: StatusPedido; versao: number }
        | undefined;
      if (!atual) throw new ErroDominio("NAO_ENCONTRADO", `pedido ${d.pedidoId} inexistente`);
      if (atual.pessoa_id === d.decididoPor) {
        throw new ErroDominio("SEM_PERMISSAO", "ninguem decide o proprio pedido");
      }
      if (atual.status !== "pendente") {
        throw new ErroDominio("TRANSICAO_INVALIDA", `pedido ja esta ${atual.status}`);
      }
      throw new ErroDominio("TRANSICAO_INVALIDA", "pedido foi alterado (versao desatualizada)");
    }

    if (aprovar) {
      if (d.recalculo) {
        db.prepare("DELETE FROM pedido_dia WHERE portal_member_id = ? AND pedido_id = ?").run(
          portalMemberId,
          d.pedidoId,
        );
        const pessoa = db
          .prepare("SELECT pessoa_id FROM pedido WHERE portal_member_id = ? AND id = ?")
          .get(portalMemberId, d.pedidoId) as { pessoa_id: string };
        ocuparDias(portalMemberId, d.pedidoId, pessoa.pessoa_id, d.recalculo.diasOcupados);
      }
      enfileirarJob(portalMemberId, d.pedidoId, "adicionar", d.decididoEm);
    } else {
      db.prepare("DELETE FROM pedido_dia WHERE portal_member_id = ? AND pedido_id = ?").run(
        portalMemberId,
        d.pedidoId,
      );
    }
    return lerPedidoInterno(portalMemberId, d.pedidoId) as Pedido;
  });
}

export interface CancelamentoPedido {
  pedidoId: number;
  canceladoPor: string;
  /** Dia (hoje) a partir do qual deixa de contar; debito vai ate canceladoEm-1. */
  canceladoEm: DataISO;
  /** Instante da operacao (enfileiramento do job). */
  instante: InstanteISO;
  /** Debito recalculado (dias uteis em [inicio, min(fim, canceladoEm-1)]). */
  diasDebitoPorAno?: Record<string, number>;
  /** Controle otimista opcional. */
  versao?: number;
}

/**
 * Cancela um pedido `pendente` ou `aprovada` de forma atomica (changes===1).
 * Aprovada => sincronizacao `remocao_pendente` + job `remover`. Libera os dias
 * de pedido_dia a partir de `canceladoEm` (dias anteriores continuam contando).
 * Quem pode cancelar (colaborador so se hoje < inicio etc.) e regra do servico.
 */
export function cancelarPedido(portalMemberId: string, c: CancelamentoPedido): Pedido {
  exigirPortal(portalMemberId);
  return emTransacao(() => {
    const db = conexao();
    const antes = db
      .prepare("SELECT status FROM pedido WHERE portal_member_id = ? AND id = ?")
      .get(portalMemberId, c.pedidoId) as { status: StatusPedido } | undefined;
    if (!antes) throw new ErroDominio("NAO_ENCONTRADO", `pedido ${c.pedidoId} inexistente`);

    const r = db
      .prepare(
        `UPDATE pedido
            SET status = 'cancelada',
                sincronizacao = CASE WHEN status = 'aprovada' THEN 'remocao_pendente' ELSE 'nao_aplicavel' END,
                cancelado_em = @em, cancelado_por = @por,
                dias_debito_por_ano = COALESCE(@ddpa, dias_debito_por_ano),
                versao = versao + 1
          WHERE portal_member_id = @m AND id = @id AND status IN ('pendente', 'aprovada')
            AND (@versao IS NULL OR versao = @versao)`,
      )
      .run({
        m: portalMemberId,
        id: c.pedidoId,
        em: c.canceladoEm,
        por: c.canceladoPor,
        ddpa: c.diasDebitoPorAno ? JSON.stringify(c.diasDebitoPorAno) : null,
        versao: c.versao ?? null,
      });
    if (r.changes !== 1) {
      if (antes.status !== "pendente" && antes.status !== "aprovada") {
        throw new ErroDominio("TRANSICAO_INVALIDA", `pedido ja esta ${antes.status}`);
      }
      throw new ErroDominio("TRANSICAO_INVALIDA", "pedido foi alterado (versao desatualizada)");
    }

    db.prepare(
      "DELETE FROM pedido_dia WHERE portal_member_id = ? AND pedido_id = ? AND dia >= ?",
    ).run(portalMemberId, c.pedidoId, c.canceladoEm);
    if (antes.status === "aprovada") {
      enfileirarJob(portalMemberId, c.pedidoId, "remover", c.instante);
    }
    return lerPedidoInterno(portalMemberId, c.pedidoId) as Pedido;
  });
}
