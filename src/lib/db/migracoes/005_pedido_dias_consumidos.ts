/**
 * Migracao 005 — datas realmente consumidas de um pedido cancelado.
 *
 * No cancelamento, `dias_consumidos` guarda (JSON, ordenado) os dias que o pedido
 * ocupou ANTES de `cancelado_em` (a partir de pedido_dia). O saldo usa essas datas
 * no FIFO: contagem sozinha nao basta, porque o vencimento de um lote cai entre dias.
 * NULL = pedido que nunca foi cancelado (ou cancelado antes desta migracao).
 *
 * NUNCA editar depois de aplicada.
 */
export const nome = "005_pedido_dias_consumidos";

export const sql = `
      ALTER TABLE pedido ADD COLUMN dias_consumidos TEXT;
    `;
