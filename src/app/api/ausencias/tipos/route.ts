import { comSessao } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.tipos", req, (s, sv) => sv.tiposPediveis(s));
}
