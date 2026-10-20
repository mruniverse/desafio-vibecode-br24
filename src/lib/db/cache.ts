/**
 * Cache local das respostas da API REST do Bitrix24.
 *
 * Requisito do desafio: "Evitar consultar a API a cada tela; usar cache e
 * sincronizacao." O cache e por portal + chave logica, com TTL e opcao de
 * servir valor vencido quando a API falha (stale-on-error), para que a tela
 * nunca fique em branco por causa de uma instabilidade do portal.
 */
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

export const TTL = {
  /** Metadados que quase nunca mudam: campos, funis, etapas. */
  metadados: 60 * 60, // 1 hora
  /** Listas de usuarios, departamentos. */
  cadastros: 15 * 60, // 15 minutos
  /** Dados operacionais: negocios, tarefas, atividades. */
  operacional: 2 * 60, // 2 minutos
} as const;

interface Registro<T> {
  payload: T;
  fetchedAt: number;
  expiresAt: number;
}

function agora(): number {
  return Math.floor(Date.now() / 1000);
}

function ler<T>(memberId: string, chave: string): Registro<T> | null {
  const r = getDb()
    .prepare(
      "SELECT payload, fetched_at, expires_at FROM api_cache WHERE member_id = ? AND cache_key = ?",
    )
    .get(memberId, chave) as Record<string, unknown> | undefined;
  if (!r) return null;
  try {
    return {
      payload: JSON.parse(String(r.payload)) as T,
      fetchedAt: Number(r.fetched_at),
      expiresAt: Number(r.expires_at),
    };
  } catch {
    return null;
  }
}

function gravar<T>(memberId: string, chave: string, payload: T, ttlSegundos: number) {
  const ts = agora();
  getDb()
    .prepare(
      `INSERT INTO api_cache (member_id, cache_key, payload, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(member_id, cache_key) DO UPDATE SET
         payload = excluded.payload,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at`,
    )
    .run(memberId, chave, JSON.stringify(payload), ts, ts + ttlSegundos);
}

export interface ResultadoCache<T> {
  dados: T;
  /** true quando veio do cache (fresco ou vencido). */
  doCache: boolean;
  /** true quando o valor esta vencido e a API falhou. */
  desatualizado: boolean;
  atualizadoEm: Date;
}

/**
 * Padrao de uso nas telas: nunca chamar a API direto, sempre por aqui.
 *
 * - cache fresco -> devolve na hora, zero chamada de rede;
 * - cache vencido -> tenta atualizar; se a API falhar, devolve o vencido
 *   marcando `desatualizado` para a UI avisar o usuario;
 * - sem cache -> busca; erro aqui propaga (nao ha o que mostrar).
 */
export async function comCache<T>(
  memberId: string,
  chave: string,
  ttlSegundos: number,
  buscar: () => Promise<T>,
  opcoes: { forcar?: boolean } = {},
): Promise<ResultadoCache<T>> {
  const existente = ler<T>(memberId, chave);
  const ts = agora();

  if (!opcoes.forcar && existente && existente.expiresAt > ts) {
    return {
      dados: existente.payload,
      doCache: true,
      desatualizado: false,
      atualizadoEm: new Date(existente.fetchedAt * 1000),
    };
  }

  try {
    const frescos = await buscar();
    gravar(memberId, chave, frescos, ttlSegundos);
    return {
      dados: frescos,
      doCache: false,
      desatualizado: false,
      atualizadoEm: new Date(),
    };
  } catch (erro) {
    if (existente) {
      logger.warn({
        evento: "cache.stale_on_error",
        portal: memberId,
        detalhe: { chave },
        erro,
      });
      return {
        dados: existente.payload,
        doCache: true,
        desatualizado: true,
        atualizadoEm: new Date(existente.fetchedAt * 1000),
      };
    }
    throw erro;
  }
}

/** Invalida uma chave ou um prefixo (ex.: `crm.deal:` apos uma escrita). */
export function invalidar(memberId: string, chaveOuPrefixo: string) {
  getDb()
    .prepare(
      "DELETE FROM api_cache WHERE member_id = ? AND (cache_key = ? OR cache_key LIKE ?)",
    )
    .run(memberId, chaveOuPrefixo, `${chaveOuPrefixo}%`);
}

/** Limpeza de registros vencidos — chamada pela rota de manutencao. */
export function limparVencidos(): number {
  const r = getDb()
    .prepare("DELETE FROM api_cache WHERE expires_at < ?")
    .run(agora());
  return r.changes;
}
