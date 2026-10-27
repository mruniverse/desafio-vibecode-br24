import { comSessao } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.saldos", req, (s, sv) => sv.saldos(s));
}
