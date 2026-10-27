/**
 * Migracao 004 — fencing das tentativas de sincronizacao.
 *
 * `geracao` sobe a cada `tomarProximoJob`. Quem grava o resultado de um job
 * (concluir/falhar/esgotar/add incerto) informa a geracao que recebeu; se o
 * lease venceu e outro processo assumiu, a geracao e outra e a gravacao do
 * processo antigo e recusada (nao sobrescreve a tentativa nova).
 *
 * NUNCA editar depois de aplicada.
 */
export const nome = "004_sync_geracao";

export const sql = `
      ALTER TABLE sync_job ADD COLUMN geracao INTEGER NOT NULL DEFAULT 0 CHECK (geracao >= 0);
    `;
