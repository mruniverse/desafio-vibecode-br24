/**
 * Servicos de configuracao inicial (wizard).
 *
 * Ponto de entrada do produto: a Onnira Cloud AI. O cliente instala o app na
 * Onnira e, de lá, conecta o proprio portal Bitrix24. O app nao roda embarcado
 * em iframe do Bitrix, entao nao dependemos de placements.
 *
 * Por isso o modo RECOMENDADO e o webhook de entrada: casa com o texto do
 * guia ("um assistente para o cliente informar tokens e parametros" / "cada
 * cliente configura os proprios tokens") e e o que um cliente conclui sozinho
 * em um minuto, sem cadastrar aplicativo nem lidar com URL de redirecionamento.
 *
 *  - WEBHOOK (recomendado): o cliente cria um "webhook de entrada" no portal e
 *    cola a URL. A URL ja contem o codigo de autenticacao e nao expira.
 *    RESSALVA IMPORTANTE: um webhook e vinculado a UM usuario — o que o criou —
 *    e toda chamada REST roda com os direitos dele. O app nao consegue, nesse
 *    modo, distinguir quem esta usando. Isso e exposto na interface, e o wizard
 *    orienta a marcar somente os escopos necessarios.
 *  - OAUTH (opcional): aplicativo local autorizado pelo usuario. Mais trabalho
 *    de configuracao, mas o unico modo que respeita permissao POR USUARIO e que
 *    habilita widgets dentro do Bitrix24. Mantido para o cliente que precisa.
 *
 * Em ambos os casos a verdade e sempre validada contra o portal real: nunca
 * marcamos a configuracao como concluida sem uma chamada REST bem-sucedida.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getDb } from "@/lib/db";
import {
  definirParametro,
  listarPortais,
  marcarSetupConcluido,
  obterParametros,
  obterPortal,
  portalAtivo,
  salvarCredenciais,
  salvarPortal,
  salvarWebhook,
  type ModoAuth,
  type Portal,
} from "@/lib/db/portals";
import { callRest, urlAutorizacao } from "@/lib/bitrix/client";
import { getEnv } from "@/lib/env";

/* ------------------------------------------------------------------ schemas */

/**
 * Webhook de entrada do Bitrix24.
 * Formato: https://<portal>/rest/<idUsuario>/<codigo>/
 */
export const schemaWebhook = z.object({
  webhookUrl: z
    .string()
    .trim()
    .min(1, "Cole a URL do webhook de entrada.")
    .refine((v) => /^https:\/\/[^\s/]+\/rest\/\d+\/[A-Za-z0-9]+\/?$/.test(v), {
      message:
        "A URL nao parece um webhook de entrada. O formato esperado e https://seu-portal.bitrix24.com.br/rest/1/codigo/",
    }),
});

export const schemaCredenciaisOauth = z.object({
  domain: z
    .string()
    .trim()
    .min(1, "Informe o endereco do seu portal.")
    // Aceita com ou sem https://, com ou sem barra final.
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .refine((v) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v), {
      message: "Endereco invalido. Exemplo: suaempresa.bitrix24.com.br",
    }),
  clientId: z.string().trim().min(1, "Informe o ID do aplicativo local."),
  clientSecret: z.string().trim().min(1, "Informe a chave secreta do aplicativo."),
});

/* ------------------------------------------------------------------- estado */

export interface EstadoConfiguracao {
  configurado: boolean;
  portal: {
    memberId: string;
    domain: string;
    modo: ModoAuth;
    conectadoEm: string;
  } | null;
  /** Parametros livres definidos no wizard. */
  parametros: Record<string, string | null>;
  /** Quantos portais ja usam esta instancia (o app e multi-cliente). */
  totalPortais: number;
}

export function estadoConfiguracao(): EstadoConfiguracao {
  const portal = portalAtivo();
  return {
    configurado: Boolean(portal),
    portal: portal
      ? {
          memberId: portal.memberId,
          domain: portal.domain,
          modo: portal.authMode,
          conectadoEm: portal.installedAt,
        }
      : null,
    parametros: portal ? obterParametros(portal.memberId) : {},
    totalPortais: listarPortais().length,
  };
}

/** Garante que existe um portal configurado, ou erro claro para a UI. */
export function exigirPortalConfigurado(): Portal {
  const portal = portalAtivo();
  if (!portal) throw new AppError("SEM_CONFIGURACAO");
  return portal;
}

/* ------------------------------------------------------- modo 1: webhook */

/**
 * Conecta por webhook: valida a URL CHAMANDO o portal antes de salvar.
 * `profile` e o metodo mais barato que prova que o webhook funciona.
 */
export async function conectarPorWebhook(
  entrada: unknown,
): Promise<{
  memberId: string;
  domain: string;
  nomeUsuario: string;
  admin: boolean;
}> {
  const { webhookUrl } = schemaWebhook.parse(entrada);
  const url = new URL(webhookUrl);
  const domain = url.host;

  // Valida contra o portal real antes de persistir qualquer coisa.
  const base = webhookUrl.replace(/\/+$/, "");
  let perfil: Record<string, unknown>;
  try {
    const resposta = await fetch(`${base}/profile.json`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await resposta.json()) as {
      result?: Record<string, unknown>;
      error?: string;
      error_description?: string;
    };
    if (json.error || !json.result) {
      throw new AppError("CREDENCIAIS_INVALIDAS", {
        tecnico: json.error_description ?? json.error ?? "profile sem result",
      });
    }
    perfil = json.result;
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    throw new AppError("PORTAL_INDISPONIVEL", {
      tecnico: erro instanceof Error ? erro.message : String(erro),
      cause: erro,
    });
  }

  // O webhook nao devolve member_id; derivamos um identificador estavel do
  // dominio para nao depender de nada fixo no codigo.
  const memberId = `webhook:${domain}`;
  salvarWebhook({ memberId, domain, webhookUrl });
  marcarSetupConcluido(memberId);

  const nomeUsuario =
    [perfil.NAME, perfil.LAST_NAME].filter(Boolean).join(" ").trim() || "Usuario";

  // Guardamos QUEM e o dono do webhook: no modo webhook toda chamada REST roda
  // com os direitos deste usuario, e a interface precisa dizer isso ao cliente
  // em vez de dar a falsa impressao de permissao por usuario.
  definirParametro(memberId, "webhook.usuario_nome", nomeUsuario);
  definirParametro(memberId, "webhook.usuario_id", String(perfil.ID ?? ""));
  definirParametro(
    memberId,
    "webhook.usuario_admin",
    perfil.ADMIN ? "true" : "false",
  );

  logger.info({
    evento: "setup.webhook.conectado",
    portal: memberId,
    detalhe: { domain, usuarioAdmin: Boolean(perfil.ADMIN) },
  });

  return { memberId, domain, nomeUsuario, admin: Boolean(perfil.ADMIN) };
}

/* --------------------------------------------------------- modo 2: oauth */

/**
 * Passo 1 do OAuth: guarda as credenciais do aplicativo local e devolve a URL
 * de autorizacao para a qual o cliente deve ser enviado.
 */
export function iniciarOauth(entrada: unknown): {
  memberId: string;
  urlAutorizar: string;
  redirectUri: string;
} {
  const dados = schemaCredenciaisOauth.parse(entrada);

  // Descarta tentativas antigas antes de criar outra: credencial de cliente
  // nao fica acumulada no banco esperando ser vazada.
  limparTentativasPendentes();

  // SEGURANCA: o `state` precisa ser imprevisivel. Se ele fosse derivado do
  // dominio (ex.: "pendente:<dominio>"), um terceiro poderia adivinha-lo e
  // completar o fluxo com um `code` proprio, associando o portal dele as
  // credenciais desta instalacao (CSRF no OAuth). Usamos um nonce aleatorio
  // que amarra o callback a ESTA tentativa.
  const nonce = randomBytes(24).toString("base64url");
  const memberId = `pendente:${nonce}`;

  // Guarda as credenciais antes do redirect: o callback precisa delas para
  // trocar o `code` por tokens.
  salvarPortalPendente(memberId, dados.domain);
  salvarCredenciais(memberId, {
    clientId: dados.clientId,
    clientSecret: dados.clientSecret,
  });

  const redirectUri = urlRedirecionamento();
  const urlAutorizar = urlAutorizacao({
    domain: dados.domain,
    clientId: dados.clientId,
    redirectUri,
    state: memberId,
  });

  logger.info({
    evento: "setup.oauth.iniciado",
    portal: memberId,
    detalhe: { domain: dados.domain },
  });

  return { memberId, urlAutorizar, redirectUri };
}

/**
 * Descarta tentativas de OAuth que nunca foram concluidas.
 *
 * Um registro `pendente:*` guarda client_id/client_secret do cliente: deixar
 * isso acumulado no banco e superficie de ataque sem beneficio nenhum.
 * Chamado no inicio de cada nova tentativa e pela rota de manutencao.
 */
export function limparTentativasPendentes(maxIdadeHoras = 1): number {
  const r = getDb()
    .prepare(
      `DELETE FROM portal
       WHERE member_id LIKE 'pendente:%'
         AND setup_completed = 0
         AND installed_at < datetime('now', ?)`,
    )
    .run(`-${maxIdadeHoras} hours`);
  return r.changes;
}

function salvarPortalPendente(memberId: string, domain: string) {
  salvarPortal({
    memberId,
    domain,
    clientEndpoint: `https://${domain}/rest`,
    authMode: "OAUTH",
  });
}

/** A URL que o cliente deve cadastrar no aplicativo local do portal. */
export function urlRedirecionamento(): string {
  return `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/bitrix/oauth/callback`;
}

/** Confirma que a conexao esta viva, nos dois modos. */
export async function testarConexao(memberId: string): Promise<{
  ok: boolean;
  domain: string;
  modo: ModoAuth;
  usuario: string;
  escopos: string[];
}> {
  const portal = obterPortal(memberId);
  if (!portal) throw new AppError("SEM_CONFIGURACAO");

  const perfil = await callRest<Record<string, unknown>>(memberId, "profile");
  const p = perfil.result ?? {};

  let escopos: string[] = [];
  try {
    const s = await callRest<string[]>(memberId, "scope");
    escopos = s.result ?? [];
  } catch {
    // `scope` nao existe em webhook; ausencia nao e falha.
    escopos = [];
  }

  return {
    ok: true,
    domain: portal.domain,
    modo: portal.authMode,
    usuario:
      [p.NAME, p.LAST_NAME].filter(Boolean).join(" ").trim() || "Usuario",
    escopos,
  };
}
