import { comSessao } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.equipes", req, (s, sv) => sv.equipes(s));
}
