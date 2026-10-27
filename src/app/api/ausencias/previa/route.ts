import { criarPedidoSchema } from "@/lib/ausencias/schemas";
import { comSessao, lerCorpo } from "../_http";

export const dynamic = "force-dynamic";

/** Calcula dias, saldo, conflito e datas livres sem gravar nada. */
export function POST(req: Request) {
  return comSessao("ausencias.previa", req, async (s, sv) => sv.previa(s, criarPedidoSchema.parse(await lerCorpo(req))));
}
