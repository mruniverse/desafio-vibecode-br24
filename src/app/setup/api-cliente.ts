/**
 * Cliente HTTP mínimo das rotas de configuração.
 *
 * As rotas respondem sempre no mesmo envelope (`{ok:true, dados}` ou
 * `{ok:false, erro}`). Centralizar a leitura aqui garante que a tela nunca
 * precise lidar com `catch` de rede nem com JSON malformado — ela só decide o
 * que mostrar a partir de um resultado já normalizado.
 */

export interface ErroApi {
  codigo: string;
  mensagem: string;
  /** Erro 422 de validação: mensagem por campo, para destacar o input certo. */
  campos?: Record<string, string>;
}

export type RespostaApi<T> =
  | { ok: true; dados: T }
  | { ok: false; erro: ErroApi };

const ERRO_REDE: ErroApi = {
  codigo: "FALHA_REDE",
  mensagem:
    "Não conseguimos falar com o servidor do aplicativo. Verifique sua conexão e tente novamente.",
};

const ERRO_FORMATO: ErroApi = {
  codigo: "RESPOSTA_INVALIDA",
  mensagem:
    "O servidor respondeu em um formato inesperado. Tente novamente em instantes.",
};

/** Valida o envelope na fronteira da rede, sem recorrer a `any`. */
function ehEnvelope<T>(valor: unknown): valor is RespostaApi<T> {
  if (typeof valor !== "object" || valor === null) return false;
  const corpo = valor as Record<string, unknown>;
  if (corpo.ok === true) return "dados" in corpo;
  if (corpo.ok === false) {
    return typeof corpo.erro === "object" && corpo.erro !== null;
  }
  return false;
}

async function lerEnvelope<T>(resposta: Response): Promise<RespostaApi<T>> {
  const corpo: unknown = await resposta.json().catch(() => null);
  return ehEnvelope<T>(corpo) ? corpo : { ok: false, erro: ERRO_FORMATO };
}

export async function getJson<T>(url: string): Promise<RespostaApi<T>> {
  try {
    const resposta = await fetch(url, { cache: "no-store" });
    return await lerEnvelope<T>(resposta);
  } catch {
    return { ok: false, erro: ERRO_REDE };
  }
}

export async function postJson<T>(
  url: string,
  corpo: unknown,
): Promise<RespostaApi<T>> {
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      cache: "no-store",
    });
    return await lerEnvelope<T>(resposta);
  } catch {
    return { ok: false, erro: ERRO_REDE };
  }
}

/* ------------------------------------------------ formatos das respostas */

export interface DadosStatus {
  configurado: boolean;
  redirectUri: string;
}

export interface DadosWebhook {
  memberId: string;
  domain: string;
  nomeUsuario: string;
  admin: boolean;
}

export interface DadosOauth {
  memberId: string;
  urlAutorizar: string;
  redirectUri: string;
}

export interface DadosDiagnostico {
  conexao: {
    ok: boolean;
    domain: string;
    modo: "OAUTH" | "WEBHOOK";
    usuario: string;
    escopos: string[];
  } | null;
  falhaConexao: string | null;
}
