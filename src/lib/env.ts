/**
 * Leitura centralizada e validada das variaveis de ambiente.
 *
 * Regra do desafio: nenhum token ou senha no codigo-fonte. Tudo vem de
 * variaveis de ambiente (ou do wizard, persistido cifrado no SQLite).
 */
import { z } from "zod";

const schema = z.object({
  APP_ENCRYPTION_KEY: z.string().min(1, "APP_ENCRYPTION_KEY nao configurada"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  BITRIX_CLIENT_ID: z.string().optional(),
  BITRIX_CLIENT_SECRET: z.string().optional(),
  DATABASE_PATH: z.string().default("./data/app.db"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Valida o ambiente uma unica vez por processo.
 * Lanca erro com mensagem legivel (requisito: tratamento de erros claro).
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse({
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
    BITRIX_CLIENT_ID: process.env.BITRIX_CLIENT_ID,
    BITRIX_CLIENT_SECRET: process.env.BITRIX_CLIENT_SECRET,
    DATABASE_PATH: process.env.DATABASE_PATH,
    LOG_LEVEL: process.env.LOG_LEVEL,
  });

  if (!parsed.success) {
    const problemas = parsed.error.issues
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuracao de ambiente invalida. Ajuste as variaveis e reinicie:\n${problemas}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Util para telas de diagnostico: diz o que falta sem expor valores. */
export function envStatus() {
  return {
    encryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY),
    baseUrl: process.env.APP_BASE_URL ?? null,
    bitrixClientIdFromEnv: Boolean(process.env.BITRIX_CLIENT_ID),
    bitrixClientSecretFromEnv: Boolean(process.env.BITRIX_CLIENT_SECRET),
  };
}
