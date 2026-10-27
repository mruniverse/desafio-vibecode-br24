import { comSessao, idDaRota, lerCorpo, semParametrosSchema, type ContextoId } from "../../../_http";

export const dynamic = "force-dynamic";

export function POST(req: Request, ctx: ContextoId) {
  return comSessao("ausencias.pedidos.cancelar", req, async (s, sv) => {
    const id = await idDaRota(ctx);
    semParametrosSchema.parse(await lerCorpo(req, true));
    return sv.cancelar(s, id);
  });
}
