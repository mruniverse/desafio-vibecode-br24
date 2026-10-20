/**
 * Porta de entrada do aplicativo.
 *
 * Enquanto o tema sorteado nao define as telas, esta pagina so faz o
 * roteamento essencial: sem portal conectado, leva o cliente ao assistente de
 * configuracao; com portal conectado, mostra a casca onde as telas do app
 * entram (src/app/(app)/).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { estadoConfiguracao } from "@/lib/setup";
import { dataHoraBr } from "@/lib/utils";

export const dynamic = "force-dynamic";

function IconePainel() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      className="size-7"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 8.25V6Zm9.75 0A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm-9.75 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 8.25 20.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75 0A2.25 2.25 0 0 1 15.75 13.5H18A2.25 2.25 0 0 1 20.25 15.75V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
      />
    </svg>
  );
}

export default async function Home() {
  const estado = estadoConfiguracao();

  // Sem portal conectado nao ha nada util a mostrar: o lugar certo e o wizard.
  if (!estado.configurado || !estado.portal) {
    redirect("/setup");
  }

  const portal = estado.portal;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="br24-fade-up mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">Aplicativo Br24</h1>
          <p className="mt-1 text-sm text-soft">
            Conectado a {portal.domain} desde {dataHoraBr(portal.conectadoEm)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tom="sucesso" pontinho>
            Portal conectado
          </Badge>
          <Badge tom="neutro">
            {portal.modo === "WEBHOOK" ? "Webhook" : "OAuth"}
          </Badge>
        </div>
      </header>

      <main id="conteudo">
        <Card className="br24-fade-up">
          <CardHeader
            titulo="Pronto para receber as funcionalidades"
            descricao="A integracao com o Bitrix24, o banco de dados e a configuracao inicial ja estao funcionando. As telas do aplicativo entram aqui."
          />
          <CardBody>
            <EmptyState
              icone={<IconePainel />}
              titulo="Nenhuma funcionalidade publicada ainda"
              descricao="Esta e a base do aplicativo. Enquanto isso, voce pode revisar a conexao com o seu portal no assistente de configuracao."
              acao={
                <Link
                  href="/setup"
                  className="br24-tap inline-flex items-center justify-center rounded-md border border-line-strong bg-card px-4 py-2 text-sm font-medium text-strong shadow-sm transition-colors hover:bg-muted"
                >
                  Revisar configuracao
                </Link>
              }
            />
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
