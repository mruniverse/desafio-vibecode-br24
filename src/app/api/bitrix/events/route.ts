/**
 * Endpoint de eventos do Bitrix24 (ONAPPINSTALL / ONAPPUNINSTALL e outros).
 *
 * O Bitrix faz POST application/x-www-form-urlencoded aqui. Dois cuidados:
 *  - validar `application_token` contra o que guardamos, para nao aceitar
 *    evento forjado por terceiro;
 *  - responder rapido: o Bitrix tem timeout curto para handlers de evento.
 */
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { marcarSetupConcluido, removerPortal } from "@/lib/db/portals";

export const dynamic = "force-dynamic";

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

  logger.info({
    evento: "bitrix.evento_recebido",
    portal: memberId,
    detalhe: { tipo: evento },
  });

  switch (evento) {
    case "ONAPPINSTALL":
      // A instalacao em si e concluida pelo fluxo OAuth; aqui so confirmamos.
      if (memberId) marcarSetupConcluido(memberId);
      break;

    case "ONAPPUNINSTALL":
      // Requisito de protecao de dados: ao desinstalar, apagamos os dados do
      // portal (tokens, cache e parametros caem por ON DELETE CASCADE).
      if (memberId) {
        removerPortal(memberId);
        logger.info({ evento: "bitrix.app_removido", portal: memberId });
      }
      break;

    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
