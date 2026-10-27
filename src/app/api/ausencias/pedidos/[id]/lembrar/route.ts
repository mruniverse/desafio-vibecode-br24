import { comSessao, idDaRota, lerCorpo, semParametrosSchema, type ContextoId } from "../../../_http";

export const dynamic = "force-dynamic";

/** "Lembrar gestor": notificacao interna, no maximo 1 por dia e pedido. */
export function POST(req: Request, ctx: ContextoId) {
  return comSessao("ausencias.pedidos.lembrar", req, async (s, sv) => {
    const id = await idDaRota(ctx);
    semParametrosSchema.parse(await lerCorpo(req, true));
    sv.lembrarGestor(s, id);
    return { lembrado: true };
  });
}
