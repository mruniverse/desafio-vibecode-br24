import { comSessao } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.sincronizacao.log", req, (s, sv) => sv.logSincronizacao(s));
}
