import { creditarSchema } from "@/lib/ausencias/schemas";
import { comSessao, lerCorpo } from "../_http";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return comSessao("ausencias.creditar", req, async (s, sv) => {
    sv.creditar(s, creditarSchema.parse(await lerCorpo(req)));
    return { creditado: true };
  });
}
