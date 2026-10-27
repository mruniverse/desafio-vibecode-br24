import { z } from "zod";
import { idDeRota } from "@/lib/ausencias/schemas";
import { comSessao, lerCorpo } from "../../_http";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ pedidoId: idDeRota.optional() }).strict();

/** Botao "Reprocessar" do log (admin). Sem pedidoId reprocessa todos que falharam. */
export function POST(req: Request) {
  return comSessao("ausencias.sincronizacao.reprocessar", req, async (s, sv) => {
    const corpo = corpoSchema.parse(await lerCorpo(req, true));
    await sv.reprocessarSincronizacao(s, corpo.pedidoId);
    return { reprocessado: true };
  });
}
