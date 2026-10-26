/**
 * Schemas de entrada (zod .strict()). Campo desconhecido = 422, o que impede
 * mass assignment: `diasUteis`, `excedeSaldo`, `status`, `decididoPor`,
 * `pessoaId` e papel NUNCA vem do cliente.
 */
import { z } from "zod";
import { MAX_DIAS_INTERVALO } from "./erros";

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data invalida");
const id = z.coerce.number().int().positive();

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

export const idDeRota = id;

export const sessaoDemoSchema = z.object({ pessoaId: z.string().min(1).max(64) }).strict();

export const criarPedidoSchema = z
  .object({
    tipoId: z.string().min(1).max(64),
    inicio: dataIso,
    fim: dataIso,
    justificativa: z.string().trim().min(10).max(500).optional(),
    motivoPrivado: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.inicio <= v.fim, { message: "fim anterior ao inicio", path: ["fim"] })
  .refine((v) => diasEntre(v.inicio, v.fim) <= MAX_DIAS_INTERVALO, {
    message: `periodo maior que ${MAX_DIAS_INTERVALO} dias`,
    path: ["fim"],
  });

export const decidirPedidoSchema = z
  .object({
    decisao: z.enum(["aprovar", "recusar"]),
    motivoDecisao: z.string().trim().min(10).max(500).optional(),
    sugestao: z.object({ inicio: dataIso, fim: dataIso }).strict().optional(),
  })
  .strict()
  .refine((v) => v.decisao === "aprovar" || !!v.motivoDecisao, {
    message: "recusa exige motivo",
    path: ["motivoDecisao"],
  });

export const creditarSchema = z
  .object({
    pessoaId: z.string().min(1).max(64),
    carteira: z.enum(["ferias", "folga"]),
    dias: z.number().int().min(1).max(60),
    motivo: z.string().trim().min(10).max(300),
    venceEm: dataIso.optional(),
  })
  .strict();

/** Variaveis permitidas nas mensagens das etapas. */
export const VARIAVEIS_ETAPA = ["nome", "periodo", "tipoPublico", "prazo"] as const;

export const etapaSchema = z
  .object({
    chave: z.enum(["enviado", "com_gestor", "confirmado", "recusado"]),
    rotulo: z.string().trim().min(2).max(40),
    mensagem: z
      .string()
      .trim()
      .min(2)
      .max(280)
      .refine(
        (m) =>
          [...m.matchAll(/\{([^}]*)\}/g)].every((x) =>
            (VARIAVEIS_ETAPA as readonly string[]).includes(x[1]),
          ),
        { message: "variavel nao permitida" },
      ),
    prazoHoras: z.number().int().min(1).max(168).optional(),
  })
  .strict();

export const minimoEquipeSchema = z
  .object({ minimoPessoas: z.number().int().min(1).max(500), contarPendentes: z.boolean() })
  .strict();
