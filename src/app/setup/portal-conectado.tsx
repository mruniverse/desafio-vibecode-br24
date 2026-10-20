"use client";

/**
 * Estado "portal já conectado".
 *
 * Fica no cliente porque concentra as duas ações que o cliente volta aqui para
 * fazer: testar a conexão sem recarregar a página e reconfigurar (que reabre o
 * assistente no mesmo lugar, sem navegação extra).
 */

import * as React from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  useToast,
} from "@/components/ui";
import { MODO_OAUTH, MODO_WEBHOOK, avisoPermissaoWebhook } from "@/lib/connection-modes";
import { dataHoraBr } from "@/lib/utils";

import { getJson, type DadosDiagnostico } from "./api-cliente";
import { WizardConfiguracao } from "./wizard";

export interface PortalConectadoProps {
  portal: {
    domain: string;
    modo: "OAUTH" | "WEBHOOK";
    conectadoEm: string;
  };
  /** Parâmetros salvos no wizard (ex.: dono do webhook). */
  parametros: Record<string, string | null>;
  redirectUri: string;
}

interface ResultadoTeste {
  ok: boolean;
  titulo: string;
  detalhe: string;
}

export function PortalConectado({
  portal,
  parametros,
  redirectUri,
}: PortalConectadoProps) {
  const toast = useToast();
  const [reconfigurando, setReconfigurando] = React.useState(false);
  const [testando, setTestando] = React.useState(false);
  const [resultado, setResultado] = React.useState<ResultadoTeste | null>(null);

  if (reconfigurando) {
    return (
      <div className="flex flex-col gap-4">
        <Alert
          tipo="info"
          titulo="Reconfigurando a conexão"
          acao={
            <Button
              variante="secondary"
              tamanho="sm"
              onClick={() => setReconfigurando(false)}
            >
              Cancelar e manter a conexão atual
            </Button>
          }
        >
          A conexão atual com <strong>{portal.domain}</strong> continua
          funcionando até você concluir o assistente abaixo.
        </Alert>
        <WizardConfiguracao redirectUri={redirectUri} />
      </div>
    );
  }

  const descricaoModo =
    portal.modo === "WEBHOOK" ? MODO_WEBHOOK : MODO_OAUTH;
  const donoWebhook = parametros["webhook.usuario_nome"] ?? null;

  async function testar() {
    setResultado(null);
    setTestando(true);
    const resposta = await getJson<DadosDiagnostico>("/api/diagnostico");
    setTestando(false);

    if (!resposta.ok) {
      setResultado({
        ok: false,
        titulo: "Não foi possível testar agora",
        detalhe: resposta.erro.mensagem,
      });
      toast.erro("Falha ao testar a conexão.");
      return;
    }

    const { conexao, falhaConexao } = resposta.dados;
    if (!conexao) {
      setResultado({
        ok: false,
        titulo: "O portal não respondeu",
        detalhe:
          falhaConexao ??
          "Não recebemos resposta do seu Bitrix24. Verifique se o webhook ou a autorização continuam válidos.",
      });
      toast.erro("O portal não respondeu.");
      return;
    }

    const escopos =
      conexao.escopos.length > 0
        ? ` Permissões ativas: ${conexao.escopos.join(", ")}.`
        : "";
    setResultado({
      ok: true,
      titulo: "Conexão funcionando",
      detalhe: `${conexao.domain} respondeu como "${conexao.usuario}".${escopos}`,
    });
    toast.sucesso("Conexão testada com sucesso!");
  }

  return (
    <Card animado>
      <CardHeader
        nivel="h2"
        titulo="Portal conectado"
        descricao="O aplicativo já está ligado ao seu Bitrix24 pela API REST oficial."
        acao={
          <Badge tom="sucesso" tamanho="md" pontinho>
            Ativo
          </Badge>
        }
      />

      <CardBody className="flex flex-col gap-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Item rotulo="Portal" valor={portal.domain} />
          <Item rotulo="Modo de conexão" valor={descricaoModo.titulo} />
          <Item rotulo="Conectado em" valor={dataHoraBr(portal.conectadoEm)} />
          <Item
            rotulo={
              portal.modo === "WEBHOOK" ? "Usuário do webhook" : "Autorização"
            }
            valor={
              portal.modo === "WEBHOOK"
                ? (donoWebhook ?? "Não identificado")
                : "Renovada automaticamente"
            }
          />
        </dl>

        {portal.modo === "WEBHOOK" ? (
          <Alert
            tipo="alerta"
            titulo="Como as permissões funcionam neste modo"
            acao={
              <Button
                variante="secondary"
                tamanho="sm"
                onClick={() => setReconfigurando(true)}
              >
                Migrar para {MODO_OAUTH.titulo}
              </Button>
            }
          >
            {avisoPermissaoWebhook(donoWebhook)}
          </Alert>
        ) : null}

        {resultado ? (
          <Alert
            tipo={resultado.ok ? "sucesso" : "erro"}
            titulo={resultado.titulo}
            onFechar={() => setResultado(null)}
          >
            {resultado.detalhe}
          </Alert>
        ) : null}
      </CardBody>

      <CardFooter>
        <Button
          variante="ghost"
          onClick={() => setReconfigurando(true)}
          className="sm:mr-auto"
        >
          Reconfigurar
        </Button>
        <Button variante="secondary" onClick={() => void testar()} loading={testando}>
          {testando ? "Testando..." : "Testar conexão"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-muted/60 px-3.5 py-2.5">
      <dt className="text-xs font-medium tracking-wide text-soft uppercase">
        {rotulo}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-strong">
        {valor}
      </dd>
    </div>
  );
}
