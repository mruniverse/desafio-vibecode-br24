/**
 * Base dos repositorios de Ausencias (SQLite sincrono via better-sqlite3).
 *
 * Convencoes (BR24-005 v2.1/v2.2):
 *  - TODA funcao publica recebe `portalMemberId` como 1o argumento e filtra
 *    por ele no SQL (multi-tenant; a cascata ao apagar o portal depende disso).
 *  - Escrita composta roda em `emTransacao` = `db.transaction(fn).immediate()`,
 *    SEM await dentro (o SQLite nao suporta transacao assincrona).
 *  - Listagens que dependem de quem pede recebem a SESSAO e filtram NO SQL
 *    (escopo proprio / equipes do gestor / todos). O papel usado e sempre o
 *    LIDO DO BANCO, nunca o `papel` da sessao.
 *  - Funcoes "sem escopo" (nomeadas na doc) existem para os servicos que ja
 *    autorizaram a operacao; nao as exponha direto numa rota.
 */
import { getDb } from "@/lib/db";
import { ErroDominio } from "../erros";
import type { SessaoDemo } from "../tipos";

/** Conexao atual (migracoes ja aplicadas). */
export function conexao() {
  return getDb();
}

function ehThenable(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

/**
 * Executa `fn` em transacao IMEDIATA (lock de escrita no BEGIN). Dentro de
 * outra transacao vira SAVEPOINT. `fn` NUNCA pode ser assincrona.
 */
export function emTransacao<T>(fn: () => T): T {
  return getDb()
    .transaction(() => {
      const r = fn();
      if (ehThenable(r)) {
        throw new Error("emTransacao: a funcao nao pode ser assincrona (sem await dentro da transacao).");
      }
      return r;
    })
    .immediate();
}

/** Codigo do erro do better-sqlite3 (ex.: SQLITE_CONSTRAINT_UNIQUE). */
function codigoSqlite(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e) {
    return String((e as { code: unknown }).code);
  }
  return "";
}

export function ehViolacaoUnica(e: unknown): boolean {
  const c = codigoSqlite(e);
  return c === "SQLITE_CONSTRAINT_UNIQUE" || c === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

export function ehViolacaoFk(e: unknown): boolean {
  return codigoSqlite(e).startsWith("SQLITE_CONSTRAINT_FOREIGNKEY");
}

export function ehViolacaoCheck(e: unknown): boolean {
  return codigoSqlite(e) === "SQLITE_CONSTRAINT_CHECK";
}

export function exigirPortal(portalMemberId: string): void {
  if (typeof portalMemberId !== "string" || portalMemberId.length === 0) {
    throw new ErroDominio("NAO_ENCONTRADO", "portalMemberId obrigatorio");
  }
}

/**
 * Fragmento SQL do escopo de visibilidade sobre uma COLUNA de pessoa
 * (ex.: `p.pessoa_id`). Parametros nomeados exigidos: @m (portal) e @sessao.
 *
 *   admin     -> qualquer pessoa do portal
 *   gestor    -> a si mesmo + pessoas das equipes que gerencia
 *   colaborador -> so a si mesmo
 *   pessoa inexistente (cookie forjado) -> nada
 */
export function sqlEscopoPessoa(colunaPessoaId: string): string {
  const papel =
    "(SELECT v.papel FROM pessoa v WHERE v.portal_member_id = @m AND v.id = @sessao)";
  return `(
    ${papel} IS NOT NULL AND (
      ${papel} = 'admin'
      OR ${colunaPessoaId} = @sessao
      OR (${papel} = 'gestor' AND EXISTS (
            SELECT 1 FROM pessoa q
              JOIN equipe e ON e.portal_member_id = q.portal_member_id AND e.id = q.equipe_id
             WHERE q.portal_member_id = @m AND q.id = ${colunaPessoaId}
               AND e.gestor_id = @sessao))
    )
  )`;
}

export function paramsEscopo(portalMemberId: string, sessao: SessaoDemo) {
  return { m: portalMemberId, sessao: sessao.pessoaId };
}

/** Papel REAL da pessoa, lido do banco (null se nao existir). */
export function papelNoBanco(
  portalMemberId: string,
  pessoaId: string,
): "colaborador" | "gestor" | "admin" | null {
  const r = getDb()
    .prepare("SELECT papel FROM pessoa WHERE portal_member_id = ? AND id = ?")
    .get(portalMemberId, pessoaId) as { papel: "colaborador" | "gestor" | "admin" } | undefined;
  return r ? r.papel : null;
}
