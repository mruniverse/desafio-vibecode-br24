/**
 * Helpers para as rotas de API: resposta padronizada e captura de erro.
 *
 * Toda rota deve usar `rota()` para que:
 *  - o erro seja logado com contexto;
 *  - o cliente receba uma mensagem em portugues, sem detalhe tecnico;
 *  - o status HTTP seja coerente com o tipo de falha.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, comoAppError, corpoErro } from "@/lib/errors";
import { logger } from "@/lib/logger";

export function ok<T>(dados: T, status = 200) {
  return NextResponse.json({ ok: true as const, dados }, { status });
}

export function erro(e: AppError) {
  return NextResponse.json(corpoErro(e), { status: e.statusHttp });
}

/** Envolve o handler de uma rota, normalizando qualquer excecao. */
export function rota<T>(
  nomeEvento: string,
  handler: () => Promise<T>,
): Promise<NextResponse> {
  return handler()
    .then((dados) => ok(dados))
    .catch((e: unknown) => {
      // Erro de validacao do Zod: devolve campo a campo, para a UI destacar
      // o input errado em vez de mostrar um alerta genérico.
      if (e instanceof ZodError) {
        const campos: Record<string, string> = {};
        for (const problema of e.issues) {
          campos[problema.path.join(".") || "_"] = problema.message;
        }
        logger.warn({ evento: `${nomeEvento}.validacao`, detalhe: { campos } });
        return NextResponse.json(
          {
            ok: false as const,
            erro: {
              codigo: "VALIDACAO" as const,
              mensagem: "Confira os campos destacados.",
              campos,
            },
          },
          { status: 422 },
        );
      }

      const appErro = comoAppError(e);
      logger.error({
        evento: nomeEvento,
        detalhe: { codigo: appErro.codigo, ...appErro.detalhe },
        erro: appErro,
      });
      return erro(appErro);
    });
}
