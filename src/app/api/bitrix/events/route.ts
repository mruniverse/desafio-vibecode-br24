/**
 * Endpoint de eventos do Bitrix24 (ONAPPINSTALL / ONAPPUNINSTALL e outros).
 *
 * SEGURANCA — esta rota e publica na internet e pode APAGAR dados de um
 * portal, entao ela autentica antes de agir:
 *
 *  1. o `application_token` recebido e comparado, em tempo constante, com o
 *     que guardamos (cifrado) na instalacao daquele portal. Sem isso,
 *     qualquer pessoa que descobrisse a URL do app poderia disparar um
 *     ONAPPUNINSTALL forjado e apagar a conexao de um cliente;
 *  2. eventos de portal desconhecido sao descartados;
 *  3. a resposta e sempre 200 com corpo minimo, para nao servir de oraculo
 *     sobre quais portais existem nesta instancia.
 *
 * Responde rapido: o Bitrix tem timeout curto para handlers de evento.
 */
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  appTokenConfere,
  marcarSetupConcluido,
  obterPortal,
  removerPortal,
} from "@/lib/db/portals";

export const dynamic = "force-dynamic";

/** Resposta unica para todos os casos: nao revela nada ao chamador. */
function aceitoSilenciosamente() {
  return NextResponse.json({ ok: true });
}

export async function POST(requisicao: Request) {
  let dados: Record<string, string> = {};
  try {
    const form = await requisicao.formData();
    dados = Object.fromEntries(
      [...form.entries()].map(([k, v]) => [k, String(v)]),
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const evento = dados.event ?? "DESCONHECIDO";
  const memberId = dados["auth[member_id]"] ?? dados.member_id ?? null;
  const appToken =
    dados["auth[application_token]"] ?? dados.application_token ?? null;

  // Sem identificacao nao ha o que fazer.
  if (!memberId || !appToken) {
    logger.warn({
      evento: "bitrix.evento_sem_credencial",
      detalhe: { tipo: evento, temMemberId: Boolean(memberId) },
    });
    return aceitoSilenciosamente();
  }

  // Portal desconhecido: descarta sem revelar que ele nao existe aqui.
  if (!obterPortal(memberId)) {
    logger.warn({
      evento: "bitrix.evento_portal_desconhecido",
      portal: memberId,
      detalhe: { tipo: evento },
    });
    return aceitoSilenciosamente();
  }

  // Autenticacao do evento. Falha aqui e tentativa de forja ou reinstalacao
  // sem o token atualizado — nos dois casos, nao agimos.
  if (!appTokenConfere(memberId, appToken)) {
    logger.error({
      evento: "bitrix.evento_token_invalido",
      portal: memberId,
      detalhe: { tipo: evento },
    });
    return aceitoSilenciosamente();
  }

  logger.info({
    evento: "bitrix.evento_recebido",
    portal: memberId,
    detalhe: { tipo: evento },
  });

  switch (evento) {
    case "ONAPPINSTALL":
      marcarSetupConcluido(memberId);
      break;

    case "ONAPPUNINSTALL":
      // Protecao de dados: ao desinstalar, apagamos os dados do portal
      // (tokens, cache e parametros caem por ON DELETE CASCADE).
      removerPortal(memberId);
      logger.info({ evento: "bitrix.app_removido", portal: memberId });
      break;

    default:
      break;
  }

  return aceitoSilenciosamente();
}
