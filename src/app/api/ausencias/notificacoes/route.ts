import { comSessao } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.notificacoes", req, (s, sv) => sv.notificacoes(s));
}
