/**
 * Log estruturado das operacoes relevantes (requisito do desafio).
 *
 * Grava em duas saidas:
 *  - stdout em JSON por linha (capturado pelos logs da Onnira Cloud AI);
 *  - tabela `operation_log` no SQLite, para a tela de diagnostico do cliente.
 *
 * Regra de ouro: NUNCA registrar token, client_secret ou payload cru que possa
 * conte-los. Use `mask()` antes de passar qualquer segredo para ca.
 */
import { getEnv } from "./env";

type Nivel = "debug" | "info" | "warn" | "error";

const PESO: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const CHAVES_SENSIVEIS = [
  "access_token",
  "refresh_token",
  "client_secret",
  "auth_id",
  "refresh_id",
  "password",
  "senha",
  "authorization",
  "apikey",
  "api_key",
  // Ausencias: texto livre pode conter dado de saude.
  "motivo",
  "justificativa",
  "motivoprivado",
  "motivo_privado",
  "motivodecisao",
  "motivo_decisao",
];

/** Remove recursivamente campos sensiveis antes de serializar. */
export function redact(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 6) return "[profundo]";
  if (valor === null || valor === undefined) return valor;
  if (Array.isArray(valor)) return valor.map((v) => redact(v, profundidade + 1));
  if (typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      saida[k] = CHAVES_SENSIVEIS.includes(k.toLowerCase())
        ? "[omitido]"
        : redact(v, profundidade + 1);
    }
    return saida;
  }
  return valor;
}

function nivelMinimo(): number {
  try {
    return PESO[getEnv().LOG_LEVEL];
  } catch {
    return PESO.info;
  }
}

export interface EntradaLog {
  /** Ex.: "bitrix.oauth.install", "bitrix.rest.call", "cache.sync" */
  evento: string;
  /** Portal do cliente (member_id), quando aplicavel. */
  portal?: string | null;
  detalhe?: Record<string, unknown>;
  erro?: unknown;
}

function escrever(nivel: Nivel, entrada: EntradaLog) {
  if (PESO[nivel] < nivelMinimo()) return;

  const linha = {
    ts: new Date().toISOString(),
    nivel,
    evento: entrada.evento,
    portal: entrada.portal ?? null,
    detalhe: redact(entrada.detalhe ?? {}),
    erro:
      entrada.erro instanceof Error
        ? { nome: entrada.erro.name, mensagem: entrada.erro.message }
        : entrada.erro
          ? String(entrada.erro)
          : undefined,
  };

  const serializado = JSON.stringify(linha);
  if (nivel === "error") console.error(serializado);
  else if (nivel === "warn") console.warn(serializado);
  else console.log(serializado);

  // Persistencia best-effort: log nunca deve derrubar a operacao principal.
  void persistir(nivel, entrada);
}

async function persistir(nivel: Nivel, entrada: EntradaLog) {
  try {
    const { getDb } = await import("./db");
    getDb()
      .prepare(
        `INSERT INTO operation_log (level, event, portal_member_id, detail, error)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        nivel,
        entrada.evento,
        entrada.portal ?? null,
        JSON.stringify(redact(entrada.detalhe ?? {})),
        entrada.erro instanceof Error ? entrada.erro.message : null,
      );
  } catch {
    // Banco ainda nao migrado ou indisponivel: o stdout ja tem a informacao.
  }
}

export const logger = {
  debug: (e: EntradaLog) => escrever("debug", e),
  info: (e: EntradaLog) => escrever("info", e),
  warn: (e: EntradaLog) => escrever("warn", e),
  error: (e: EntradaLog) => escrever("error", e),
};
