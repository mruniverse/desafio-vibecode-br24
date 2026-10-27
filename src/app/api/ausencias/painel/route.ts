import { comSessao, lerQuery, painelQuerySchema } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.painel", req, (s, sv) => sv.painel(s, painelQuerySchema.parse(lerQuery(req)).equipeId));
}
