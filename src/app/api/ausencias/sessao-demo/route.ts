/**
 * Sessao-demo. GET informa o contexto (sem exigir sessao); POST aceita SOMENTE
 * `{pessoaId}` e so com MODO_DEMO=1; DELETE sai. O papel vem do cadastro.
 */
import { rota } from "@/lib/api";
import { sessaoDemoSchema } from "@/lib/ausencias/schemas";
import { erroCampo, naoEncontrado } from "../_erros";
import { lerCorpo, semCache } from "../_http";
import { apagarCookie, gravarCookie, lerSessao, limitarCriacaoDeSessao, modoDemoLigado, SELO_DEMO, verificarOrigem } from "../_sessao";
import { obterApoioDemo } from "../_servicos";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const res = await rota("ausencias.sessao-demo.contexto", async () => {
    const ligado = modoDemoLigado();
    const apoio = obterApoioDemo();
    const sessao = ligado ? lerSessao(req) : null;
    const atual = sessao ? (apoio.pessoasDemo().find((p) => p.id === sessao.pessoaId) ?? null) : null;
    return {
      modoDemo: ligado,
      selo: ligado ? SELO_DEMO : null,
      hoje: apoio.hoje(),
      atual,
      pessoas: ligado ? apoio.pessoasDemo() : [],
    };
  });
  return semCache(res);
}

export async function POST(req: Request) {
  let pessoaId: string | null = null;
  const res = await rota("ausencias.sessao-demo.entrar", async () => {
    if (!modoDemoLigado()) throw naoEncontrado();
    verificarOrigem(req);
    limitarCriacaoDeSessao(req);
    const corpo = sessaoDemoSchema.parse(await lerCorpo(req));
    const pessoa = obterApoioDemo()
      .pessoasDemo()
      .find((p) => p.id === corpo.pessoaId);
    if (!pessoa) throw erroCampo("pessoaId", "Escolha uma pessoa da lista.");
    pessoaId = pessoa.id;
    return { pessoa, selo: SELO_DEMO };
  });
  if (res.status === 200 && pessoaId) gravarCookie(res, pessoaId);
  return semCache(res);
}

export async function DELETE(req: Request) {
  const res = await rota("ausencias.sessao-demo.sair", async () => {
    verificarOrigem(req);
    return { saiu: true };
  });
  apagarCookie(res);
  return semCache(res);
}
