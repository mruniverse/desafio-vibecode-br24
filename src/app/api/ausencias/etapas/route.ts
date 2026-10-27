import { etapaSchema } from "@/lib/ausencias/schemas";
import { comSessao, lerCorpo } from "../_http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return comSessao("ausencias.etapas.listar", req, (_s, sv) => sv.etapas());
}

/** Admin edita rotulo, mensagem e prazo de UMA etapa fixa. */
export function PUT(req: Request) {
  return comSessao("ausencias.etapas.editar", req, async (s, sv) => sv.editarEtapa(s, etapaSchema.parse(await lerCorpo(req))));
}
