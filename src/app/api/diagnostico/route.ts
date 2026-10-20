/**
 * Diagnostico da instalacao: o que o cliente (e a banca) ve para confirmar
 * que o app esta realmente integrado, sem expor nenhum segredo.
 */
import { rota } from "@/lib/api";
import { estadoConfiguracao, testarConexao } from "@/lib/setup";
import { limparVencidos } from "@/lib/db/cache";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return rota("api.diagnostico", async () => {
    const estado = estadoConfiguracao();

    let conexao: Awaited<ReturnType<typeof testarConexao>> | null = null;
    let falhaConexao: string | null = null;

    if (estado.portal) {
      try {
        conexao = await testarConexao(estado.portal.memberId);
      } catch (e) {
        falhaConexao =
          e instanceof Error ? e.message : "Falha ao falar com o portal.";
      }
    }

    const db = getDb();
    const cache = db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN expires_at < unixepoch() THEN 1 ELSE 0 END) AS vencidos FROM api_cache",
      )
      .get() as { total: number; vencidos: number | null };

    const ultimosLogs = db
      .prepare(
        `SELECT created_at, level, event, error FROM operation_log
         ORDER BY id DESC LIMIT 20`,
      )
      .all();

    return {
      configuracao: estado,
      conexao,
      falhaConexao,
      cache: {
        registros: cache.total,
        vencidos: cache.vencidos ?? 0,
      },
      ultimosLogs,
    };
  });
}

/** Manutencao: limpa o cache vencido. */
export async function POST() {
  return rota("api.diagnostico.limpar_cache", async () => ({
    removidos: limparVencidos(),
  }));
}
