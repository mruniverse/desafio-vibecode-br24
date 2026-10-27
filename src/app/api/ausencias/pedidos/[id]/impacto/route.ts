import { comSessao, idDaRota, type ContextoId } from "../../../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request, ctx: ContextoId) {
  return comSessao("ausencias.pedidos.impacto", req, async (s, sv) => sv.impacto(s, await idDaRota(ctx)));
}
