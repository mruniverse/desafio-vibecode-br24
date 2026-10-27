import { comSessao, idDaRota, type ContextoId } from "../../_http";

export const dynamic = "force-dynamic";

/** 404 quando o pedido nao existe OU nao e visivel para esta sessao. */
export function GET(req: Request, ctx: ContextoId) {
  return comSessao("ausencias.pedidos.ver", req, async (s, sv) => sv.pedido(s, await idDaRota(ctx)));
}
