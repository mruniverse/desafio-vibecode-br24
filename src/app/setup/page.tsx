/**
 * Assistente de configuração inicial.
 *
 * Server Component: o estado real da configuração é lido no servidor, então a
 * tela já chega pintada — sem piscar "carregando" nem revelar o wizard para
 * quem já está conectado.
 */
import type { Metadata } from "next";

import { Alert } from "@/components/ui";
import { estadoConfiguracao, urlRedirecionamento } from "@/lib/setup";

import { PortalConectado } from "./portal-conectado";
import { WizardConfiguracao } from "./wizard";

export const metadata: Metadata = {
  title: "Configuração inicial",
  description:
    "Conecte seu portal Bitrix24 ao aplicativo em poucos minutos, pela API REST oficial.",
};

// Lê o banco e depende de searchParams: nada aqui pode ser pré-renderizado.
export const dynamic = "force-dynamic";

interface PaginaSetupProps {
  // Em Next 15 os searchParams chegam como Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function texto(valor: string | string[] | undefined): string | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

export default async function PaginaSetup({ searchParams }: PaginaSetupProps) {
  const parametrosUrl = await searchParams;
  const status = texto(parametrosUrl.status);
  const motivo = texto(parametrosUrl.motivo);
  const portalRetornado = texto(parametrosUrl.portal);

  const estado = estadoConfiguracao();
  const redirectUri = urlRedirecionamento();

  return (
    <div className="flex flex-col gap-6">
      <header className="br24-fade-up">
        <p className="text-sm font-medium text-brand-600">
          Instalação em 3 etapas
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-strong sm:text-3xl">
          Conecte seu Bitrix24
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft sm:text-base">
          O aplicativo roda na Onnira Cloud AI e conversa com o seu portal pela
          API REST oficial do Bitrix24. Nenhuma credencial fica no código: tudo
          o que você informar aqui é guardado cifrado nesta instalação.
        </p>
      </header>

      {/* Retorno do OAuth: o callback redireciona para cá com o desfecho. */}
      {status === "ok" ? (
        <Alert tipo="sucesso" titulo="Autorização concluída no Bitrix24">
          {portalRetornado
            ? `O portal ${portalRetornado} autorizou o aplicativo com sucesso.`
            : "O portal autorizou o aplicativo com sucesso."}
        </Alert>
      ) : null}

      {status === "erro" ? (
        <Alert tipo="erro" titulo="A autorização não foi concluída">
          {motivo ??
            "Não conseguimos concluir a autorização no Bitrix24. Refaça o processo."}
        </Alert>
      ) : null}

      {estado.configurado && estado.portal ? (
        <PortalConectado
          portal={{
            domain: estado.portal.domain,
            modo: estado.portal.modo,
            conectadoEm: estado.portal.conectadoEm,
          }}
          parametros={estado.parametros}
          redirectUri={redirectUri}
        />
      ) : (
        <WizardConfiguracao redirectUri={redirectUri} />
      )}

      <p className="text-center text-xs text-soft">
        Dúvida em algum passo? Todos os campos indicam exatamente onde o valor
        aparece no seu Bitrix24.
      </p>
    </div>
  );
}
