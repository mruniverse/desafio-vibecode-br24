import { comSessao, janelaQuerySchema, lerQuery } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.calendario", req, (s, sv) => {
    const q = janelaQuerySchema.parse(lerQuery(req));
    return sv.calendario(s, q.equipeId, q.de, q.ate);
  });
}
