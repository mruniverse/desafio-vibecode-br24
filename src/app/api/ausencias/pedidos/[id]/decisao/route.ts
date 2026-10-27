import { decidirPedidoSchema } from "@/lib/ausencias/schemas";
import { comSessao, idDaRota, lerCorpo, type ContextoId } from "../../../_http";

export const dynamic = "force-dynamic";

/** Aprovar/recusar/sugerir. `decididoPor` e `status` sao sempre do servidor. */
export function POST(req: Request, ctx: ContextoId) {
  return comSessao("ausencias.pedidos.decidir", req, async (s, sv) => {
    const id = await idDaRota(ctx);
    return sv.decidir(s, id, decidirPedidoSchema.parse(await lerCorpo(req)));
  });
}
