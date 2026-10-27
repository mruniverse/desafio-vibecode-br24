import { minimoEquipeSchema } from "@/lib/ausencias/schemas";
import { comSessao, lerCorpo } from "../../../_http";

export const dynamic = "force-dynamic";

/** `id` aqui e a chave da equipe (texto), nao numero. Negado = 403; equipe inexistente = 404. */
export function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return comSessao("ausencias.equipes.minimo", req, async (s, sv) => {
    const { id } = await ctx.params;
    return sv.definirMinimo(s, id.slice(0, 64), minimoEquipeSchema.parse(await lerCorpo(req)));
  });
}
