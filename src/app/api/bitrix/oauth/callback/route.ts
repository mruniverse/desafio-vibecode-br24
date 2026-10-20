/**
 * Callback do OAuth do Bitrix24.
 *
 * O portal redireciona o navegador para ca com `?code=...&state=...&domain=...`
 * O `state` traz o memberId pendente que criamos em `iniciarOauth`, e e por
 * ele que recuperamos as credenciais para trocar o code por tokens.
 *
 * Nunca devolve token no corpo nem na URL: ao terminar, redireciona para o
 * wizard com um indicador de sucesso ou erro.
 */
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { trocarCodePorTokens } from "@/lib/bitrix/client";
import {
  marcarSetupConcluido,
  obterCredenciais,
  removerPortal,
  salvarAppToken,
  salvarCredenciais,
  salvarPortal,
  salvarTokens,
} from "@/lib/db/portals";

export const dynamic = "force-dynamic";

function voltarParaWizard(parametros: Record<string, string>) {
  const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/setup`);
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
  return NextResponse.redirect(url.toString());
}

export async function GET(requisicao: Request) {
  const url = new URL(requisicao.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const erroPortal = url.searchParams.get("error");

  // O usuario pode ter recusado a autorizacao no portal.
  if (erroPortal) {
    logger.warn({
      evento: "bitrix.oauth.recusado",
      detalhe: { erro: erroPortal },
    });
    return voltarParaWizard({
      status: "erro",
      motivo: "A autorizacao foi recusada no portal.",
    });
  }

  if (!code || !state) {
    return voltarParaWizard({
      status: "erro",
      motivo: "Retorno do Bitrix24 incompleto. Refaca a autorizacao.",
    });
  }

  const credenciais = obterCredenciais(state);
  if (!credenciais) {
    return voltarParaWizard({
      status: "erro",
      motivo:
        "Nao encontramos as credenciais desta tentativa. Preencha o formulario novamente.",
    });
  }

  try {
    const tokens = await trocarCodePorTokens({
      code,
      clientId: credenciais.clientId,
      clientSecret: credenciais.clientSecret,
    });

    // O member_id definitivo vem do Bitrix. Migramos o registro pendente
    // (`pendente:<dominio>`) para a chave real do portal.
    const memberIdReal = tokens.member_id ?? state;
    const domain =
      tokens.domain ?? new URL(`https://${state.replace(/^pendente:/, "")}`).host;
    const clientEndpoint = tokens.client_endpoint ?? `https://${domain}/rest/`;

    salvarPortal({
      memberId: memberIdReal,
      domain,
      clientEndpoint,
      authMode: "OAUTH",
    });
    salvarCredenciais(memberIdReal, credenciais);
    salvarTokens(memberIdReal, {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresAt: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600),
      scope: tokens.scope,
    });
    marcarSetupConcluido(memberIdReal);

    // Guarda o application_token para autenticar os eventos que o portal
    // enviar depois (ONAPPUNINSTALL apaga dados: nao pode ser forjavel).
    if (tokens.application_token) {
      salvarAppToken(memberIdReal, tokens.application_token);
    }

    // Limpa o registro temporario, se a chave mudou.
    if (memberIdReal !== state) removerPortal(state);

    logger.info({
      evento: "bitrix.oauth.instalado",
      portal: memberIdReal,
      detalhe: { domain, escopos: tokens.scope },
    });

    return voltarParaWizard({ status: "ok", portal: domain });
  } catch (e) {
    const appErro = e instanceof AppError ? e : null;
    logger.error({ evento: "bitrix.oauth.callback_falhou", erro: e });
    return voltarParaWizard({
      status: "erro",
      motivo:
        appErro?.mensagemUsuario ??
        "Nao conseguimos concluir a autorizacao. Tente novamente.",
    });
  }
}
