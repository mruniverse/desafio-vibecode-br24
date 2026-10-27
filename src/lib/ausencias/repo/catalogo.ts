/**
 * Repositorio do catalogo: tipos, equipes, pessoas e etapas.
 * Leituras sao do portal inteiro (dados de configuracao, sem segredo); a
 * autorizacao de quem pode EDITAR e do servico.
 */
import { ErroDominio } from "../erros";
import type { ChaveEtapa, Equipe, Etapa, Papel, Pessoa, Tipo } from "../tipos";
import { conexao, exigirPortal } from "./base";

const ORDEM_ETAPAS: ChaveEtapa[] = ["enviado", "com_gestor", "confirmado", "recusado"];

export function listarTipos(portalMemberId: string): Tipo[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare("SELECT * FROM tipo WHERE portal_member_id = ? ORDER BY rowid")
    .all(portalMemberId) as {
    id: string;
    nome: string;
    quem_pede: "todos" | "admin";
    consome_saldo: "ferias" | "folga" | null;
    sensivel: number;
    cor: string;
  }[];
  return linhas.map((r) => ({
    id: r.id,
    nome: r.nome,
    quemPede: r.quem_pede,
    consomeSaldo: r.consome_saldo,
    sensivel: r.sensivel === 1,
    cor: r.cor,
  }));
}

interface LinhaEquipe {
  id: string;
  nome: string;
  gestor_id: string;
  minimo_pessoas: number;
  contar_pendentes: number;
}

function paraEquipe(r: LinhaEquipe): Equipe {
  return {
    id: r.id,
    nome: r.nome,
    gestorId: r.gestor_id,
    minimoPessoas: r.minimo_pessoas,
    contarPendentes: r.contar_pendentes === 1,
  };
}

export function listarEquipes(portalMemberId: string): Equipe[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare("SELECT * FROM equipe WHERE portal_member_id = ? ORDER BY rowid")
    .all(portalMemberId) as LinhaEquipe[];
  return linhas.map(paraEquipe);
}

export function obterEquipe(portalMemberId: string, equipeId: string): Equipe | null {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare("SELECT * FROM equipe WHERE portal_member_id = ? AND id = ?")
    .get(portalMemberId, equipeId) as LinhaEquipe | undefined;
  return r ? paraEquipe(r) : null;
}

/** Minimo de pessoas e interruptor "contar pendentes". Quem pode e do servico. */
export function definirMinimoEquipe(
  portalMemberId: string,
  equipeId: string,
  minimoPessoas: number,
  contarPendentes: boolean,
): Equipe {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare(
      `UPDATE equipe SET minimo_pessoas = ?, contar_pendentes = ?
        WHERE portal_member_id = ? AND id = ?`,
    )
    .run(minimoPessoas, contarPendentes ? 1 : 0, portalMemberId, equipeId);
  if (r.changes !== 1) throw new ErroDominio("NAO_ENCONTRADO", `equipe ${equipeId} inexistente`);
  return obterEquipe(portalMemberId, equipeId) as Equipe;
}

interface LinhaPessoa {
  id: string;
  nome: string;
  equipe_id: string;
  papel: Papel;
  aprovador_id: string;
  funcao: string | null;
  bitrix_user_id: number | null;
}

function paraPessoa(r: LinhaPessoa): Pessoa {
  const p: Pessoa = {
    id: r.id,
    nome: r.nome,
    equipeId: r.equipe_id,
    papel: r.papel,
    aprovadorId: r.aprovador_id,
  };
  if (r.funcao !== null) p.funcao = r.funcao;
  if (r.bitrix_user_id !== null) p.bitrixUserId = r.bitrix_user_id;
  return p;
}

export function obterPessoa(portalMemberId: string, pessoaId: string): Pessoa | null {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare("SELECT * FROM pessoa WHERE portal_member_id = ? AND id = ?")
    .get(portalMemberId, pessoaId) as LinhaPessoa | undefined;
  return r ? paraPessoa(r) : null;
}

export function listarPessoas(portalMemberId: string): Pessoa[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare("SELECT * FROM pessoa WHERE portal_member_id = ? ORDER BY rowid")
    .all(portalMemberId) as LinhaPessoa[];
  return linhas.map(paraPessoa);
}

/** Membros = pessoas com equipeId (gestor incluso). */
export function listarPessoasDaEquipe(portalMemberId: string, equipeId: string): Pessoa[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare("SELECT * FROM pessoa WHERE portal_member_id = ? AND equipe_id = ? ORDER BY rowid")
    .all(portalMemberId, equipeId) as LinhaPessoa[];
  return linhas.map(paraPessoa);
}

export function listarEtapas(portalMemberId: string): Etapa[] {
  exigirPortal(portalMemberId);
  const linhas = conexao()
    .prepare("SELECT * FROM etapa WHERE portal_member_id = ?")
    .all(portalMemberId) as {
    chave: ChaveEtapa;
    rotulo: string;
    mensagem: string;
    prazo_horas: number | null;
  }[];
  return linhas
    .map((r) => {
      const e: Etapa = { chave: r.chave, rotulo: r.rotulo, mensagem: r.mensagem };
      if (r.prazo_horas !== null) e.prazoHoras = r.prazo_horas;
      return e;
    })
    .sort((a, b) => ORDEM_ETAPAS.indexOf(a.chave) - ORDEM_ETAPAS.indexOf(b.chave));
}

/**
 * Atualiza rotulo/mensagem/prazo de uma das 4 etapas fixas. Valide antes com
 * `etapaSchema` (whitelist de variaveis); a etapa precisa existir.
 */
export function salvarEtapa(portalMemberId: string, etapa: Etapa): void {
  exigirPortal(portalMemberId);
  const r = conexao()
    .prepare(
      `UPDATE etapa SET rotulo = ?, mensagem = ?, prazo_horas = ?
        WHERE portal_member_id = ? AND chave = ?`,
    )
    .run(etapa.rotulo, etapa.mensagem, etapa.prazoHoras ?? null, portalMemberId, etapa.chave);
  if (r.changes !== 1) throw new ErroDominio("NAO_ENCONTRADO", `etapa ${etapa.chave} inexistente`);
}
