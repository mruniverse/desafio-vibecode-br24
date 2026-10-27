import { criarPedidoSchema } from "@/lib/ausencias/schemas";
import { comSessao, lerCorpo } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.pedidos.meus", req, (s, sv) => sv.meusPedidos(s));
}

/** Corpo estrito `{tipoId, inicio, fim, justificativa?, motivoPrivado?}`: status/diasUteis/pessoaId = 422. */
export function POST(req: Request) {
  return comSessao("ausencias.pedidos.criar", req, async (s, sv) => sv.solicitar(s, criarPedidoSchema.parse(await lerCorpo(req))));
}
