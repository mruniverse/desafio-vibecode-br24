/**
 * Migracao 003 — fila de sincronizacao com o calendario do Bitrix24
 * (BR24-005 v2.2; criada no C2, consumida no C3).
 *
 * Um job por (pedido, operacao): `adicionar` ao aprovar, `remover` ao cancelar.
 * Jobs do mesmo pedido sao seriais (a regra fica no repositorio). `lease_ate`
 * evita que dois processos peguem o mesmo job. `ultimo_erro` guarda so mensagem
 * tecnica curta (sem motivo/justificativa).
 *
 * NUNCA editar depois de aplicada.
 */
export const nome = "003_ausencias_sync";

export const sql = `
      CREATE TABLE IF NOT EXISTS sync_job (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        pedido_id        INTEGER NOT NULL,
        operacao         TEXT NOT NULL CHECK (operacao IN ('adicionar', 'remover')),
        estado           TEXT NOT NULL DEFAULT 'pendente'
                           CHECK (estado IN ('pendente', 'em_andamento', 'ok', 'falha', 'falha_manual')),
        tentativas       INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
        proxima_em       TEXT,
        ultimo_erro      TEXT,
        lease_ate        TEXT,
        criado_em        TEXT NOT NULL,
        atualizado_em    TEXT NOT NULL,
        UNIQUE (pedido_id, operacao),
        FOREIGN KEY (portal_member_id, pedido_id) REFERENCES pedido (portal_member_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sync_job_fila   ON sync_job (portal_member_id, estado, proxima_em);
      CREATE INDEX IF NOT EXISTS idx_sync_job_pedido ON sync_job (portal_member_id, pedido_id);
    `;
