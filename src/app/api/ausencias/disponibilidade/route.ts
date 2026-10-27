import { comSessao, janelaQuerySchema, lerQuery } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.disponibilidade", req, (s, sv) => {
    const q = janelaQuerySchema.parse(lerQuery(req));
    return sv.disponibilidade(s, q.equipeId, q.de, q.ate);
  });
}
