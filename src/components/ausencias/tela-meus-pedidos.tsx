"use client";

import * as React from "react";
import { Card, CardHeader } from "@/components/ui";
import type { Tipo } from "@/lib/ausencias/tipos";
import type { NotificacaoVisao, PedidoVisao, SaldoVisao } from "@/lib/ausencias/visoes";
import { api, type Resp } from "./api";
import { CartaoSaldo } from "./cartao-saldo";
import { useAusencias } from "./contexto";
import { EstadoDaTela, Vazio } from "./estados";
import { dataCurta } from "./formatos";
import { LinkBotao, ListaPedidos } from "./lista-pedidos";
import { CartaoEmAndamento } from "./trilho-pedido";
import { useCarregar } from "./use-carregar";

interface Dados {
  pedidos: PedidoVisao[];
  saldos: SaldoVisao[];
  avisos: NotificacaoVisao[];
  /** Só serve para achar o tipo certo no botão "Pedir nessa data"; se falhar, segue sem. */
  tipos: Tipo[];
}

async function buscarTudo(): Promise<Resp<Dados>> {
  const [pedidos, saldos, avisos, tipos] = await Promise.all([
    api.meusPedidos(),
    api.saldos(),
    api.notificacoes(),
    api.tipos(),
  ]);
  if (!pedidos.ok) return pedidos;
  if (!saldos.ok) return saldos;
  if (!avisos.ok) return avisos;
  return {
    ok: true,
    dados: {
      pedidos: pedidos.dados,
      saldos: saldos.dados,
      avisos: avisos.dados,
      tipos: tipos.ok ? tipos.dados : [],
    },
  };
}

function PedirAusencia() {
  return <LinkBotao href="/ausencias/pedir">Pedir ausência</LinkBotao>;
}

function Conteudo({ dados, onCancelado }: { dados: Dados; onCancelado: () => void }) {
  const { hoje } = useAusencias();
  const andamento = dados.pedidos.filter((p) => p.status === "pendente").sort((a, b) => a.inicio.localeCompare(b.inicio));
  const anteriores = dados.pedidos.filter((p) => p.status !== "pendente").sort((a, b) => b.inicio.localeCompare(a.inicio));
  const avisos = [...dados.avisos].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)).slice(0, 5);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {dados.pedidos.length === 0 ? (
          <Vazio
            titulo="Você ainda não pediu nenhuma ausência"
            descricao="Quando você pedir, o pedido aparece aqui e você acompanha cada passo."
            acao={<PedirAusencia />}
          />
        ) : null}

        {andamento.length > 0 ? (
          <section aria-labelledby="titulo-andamento" className="flex flex-col gap-3">
            <h2 id="titulo-andamento" className="text-lg font-semibold text-strong">
              Pedido em andamento
            </h2>
            <p className="text-sm text-soft">Você recebe cada atualização aqui no app.</p>
            {andamento.map((p) => (
              <CartaoEmAndamento key={p.id} pedido={p} hoje={hoje} onCancelado={onCancelado} />
            ))}
          </section>
        ) : null}

        {anteriores.length > 0 ? (
          <section aria-labelledby="titulo-anteriores">
            <Card>
              <CardHeader nivel="h2" titulo="Pedidos anteriores" id="titulo-anteriores" />
              <ListaPedidos pedidos={anteriores} hoje={hoje} tipos={dados.tipos} onCancelado={onCancelado} />
            </Card>
          </section>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <CartaoSaldo saldos={dados.saldos} />
        <section aria-labelledby="titulo-avisos">
          <Card>
            <CardHeader nivel="h2" titulo="Avisos recentes" id="titulo-avisos" />
            {avisos.length === 0 ? (
              <p className="px-4 py-4 text-sm text-soft sm:px-5">Nenhum aviso por enquanto.</p>
            ) : (
              <ul className="divide-y divide-line">
                {avisos.map((a) => (
                  <li key={a.id} className="px-4 py-3 sm:px-5">
                    <p className="text-sm text-body">{a.texto}</p>
                    <p className="mt-0.5 text-xs text-soft">{dataCurta(a.criadaEm.slice(0, 10))}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

export function TelaMeusPedidos() {
  const buscar = React.useCallback(() => buscarTudo(), []);
  const { estado, recarregar, tentarDeNovo } = useCarregar(buscar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-strong">Meus pedidos</h1>
          <p className="mt-1 text-base text-body">
            Aqui você pede e acompanha suas ausências. Seus pedidos vão para o seu gestor direto.
          </p>
        </div>
        <div className="shrink-0">
          <PedirAusencia />
        </div>
      </div>
      <EstadoDaTela estado={estado} onTentarDeNovo={tentarDeNovo} rotuloCarregando="Carregando seus pedidos…">
        {(dados) => <Conteudo dados={dados} onCancelado={recarregar} />}
      </EstadoDaTela>
    </div>
  );
}
