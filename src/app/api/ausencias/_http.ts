/**
 * Utilitarios finos das rotas /api/ausencias/*: sessao, corpo JSON, query e id.
 * As rotas so validam (zod .strict()), chamam o servico e devolvem o envelope
 * padrao de `rota()`. Nenhuma regra de negocio mora aqui.
 */
import type { NextResponse } from "next/server";
import { z } from "zod";
import { rota } from "@/lib/api";
import type { ServicosAusencias } from "@/lib/ausencias/servicos";
import { idDeRota } from "@/lib/ausencias/schemas";
import { ehDataISO } from "@/lib/ausencias/datas";
import type { SessaoDemo } from "@/lib/ausencias/tipos";
import { erroCampo, naoEncontrado } from "./_erros";
import { exigirSessao } from "./_sessao";
import { obterServicos } from "./_servicos";

export interface ContextoId {
  params: Promise<{ id: string }>;
}

const TAMANHO_MAXIMO_CORPO = 20_000;

export function semCache(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Exige sessao ANTES de ler o corpo; devolve o envelope `{ok, dados|erro}`. */
export async function comSessao<T>(
  evento: string,
  req: Request,
  fn: (sessao: SessaoDemo, servicos: ServicosAusencias) => Promise<T> | T,
): Promise<NextResponse> {
  const res = await rota(evento, async () => {
    const sessao = exigirSessao(req);
    const servicos = obterServicos();
    await servicos.aquecerCalendario();
    return fn(sessao, servicos);
  });
  return semCache(res);
}

/** Corpo JSON. `opcional`: corpo vazio vira `{}` (acoes sem parametros). */
export async function lerCorpo(req: Request, opcional = false): Promise<unknown> {
  const texto = await req.text();
  if (texto.length > TAMANHO_MAXIMO_CORPO) throw erroCampo("_", "O conteúdo enviado é grande demais.");
  if (texto.trim() === "") {
    if (opcional) return {};
    throw erroCampo("_", "Envie os dados em JSON.");
  }
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw erroCampo("_", "O conteúdo enviado não é um JSON válido.");
  }
}

/** Acao sem parametros: corpo vazio ou `{}`; qualquer campo extra = 422. */
export const semParametrosSchema = z.object({}).strict();

/** Id de rota inteiro positivo; qualquer outro valor = 404 (nao entrega pista). */
export async function idDaRota(ctx: ContextoId): Promise<number> {
  const { id } = await ctx.params;
  const lido = idDeRota.safeParse(id);
  if (!lido.success) throw naoEncontrado();
  return lido.data;
}

const dataIso = z.string().refine(ehDataISO, "data invalida");
const idEquipe = z.string().min(1).max(64);

/**
 * Query: so as chaves conhecidas sao lidas; o resto (ex.: `?pessoaId=`) e
 * descartado, entao nao muda quem e a sessao.
 */
export const janelaQuerySchema = z.object({ equipeId: idEquipe, de: dataIso, ate: dataIso });
export const painelQuerySchema = z.object({ equipeId: idEquipe.optional() });

export function lerQuery(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}
