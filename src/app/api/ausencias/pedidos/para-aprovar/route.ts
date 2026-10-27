import { comSessao } from "../../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.pedidos.para-aprovar", req, (s, sv) => sv.paraAprovar(s));
}
