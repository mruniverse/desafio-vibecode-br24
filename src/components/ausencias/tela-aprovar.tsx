"use client";

import * as React from "react";
import type { Equipe } from "@/lib/ausencias/tipos";
import type { ImpactoPedidoVisao, PedidoVisao } from "@/lib/ausencias/visoes";
import { Alert, Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { useAusencias } from "./contexto";
import { Carregando, EstadoDaTela, Vazio } from "./estados";
import { dataCurta, iniciais, periodo, plural, primeiroNome } from "./formatos";
import { DecisaoPedido } from "./decisao-pedido";
import { GraficoSemanas } from "./grafico-semanas";
import { Cabecalho } from "./seletor-equipe";
import { useCarregar } from "./use-carregar";

const TITULO = "Pedidos para aprovar";
const SUBTITULO = "Cada pedido já chega com o que você precisa para decidir.";

export function TelaAprovar() {
  const { hoje } = useAusencias();
  const { estado, recarregar, tentarDeNovo } = useCarregar(api.paraAprovar);
  // Equipes só alimentam o "mínimo" e o nome da equipe: se falhar, a tela segue sem essas linhas.
  const equipes = useCarregar(api.equipes);
  const listaEquipes = equipes.estado.status === "pronto" ? equipes.estado.dados : [];

  const [escolhido, setEscolhido] = React.useState<number | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const detalheRef = React.useRef<HTMLDivElement>(null);

  function selecionar(id: number) {
    setEscolhido(id);
    setAviso(null);
    // No celular o detalhe fica abaixo da fila: leva a pessoa até ele.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => {
        detalheRef.current?.scrollIntoView({ behavior: quieto ? "auto" : "smooth", block: "start" });
        detalheRef.current?.focus({ preventScroll: true });
      });
    }
  }

  function aoAtualizar(msg?: string) {
    setAviso(msg ?? null);
    recarregar();
  }

  return (
    <>
      <Cabecalho titulo={TITULO} subtitulo={SUBTITULO} />
      {aviso ? (
        <Alert tipo="erro" titulo="Este pedido mudou" onFechar={() => setAviso(null)} className="mb-4">
          {aviso} A lista foi atualizada. Confira o pedido e decida de novo.
        </Alert>
      ) : null}
      <EstadoDaTela
        estado={estado}
        onTentarDeNovo={tentarDeNovo}
        rotuloCarregando="Carregando os pedidos para aprovar…"
        vazio={(d) => d.length === 0}
        renderVazio={() => (
          <Vazio titulo="Nenhum pedido para aprovar. Tudo em dia!" descricao="Quando alguém pedir, o pedido aparece aqui." />
        )}
      >
        {(pedidos) => {
          const atual = pedidos.find((p) => p.id === escolhido) ?? pedidos[0];
          return (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
              <Fila pedidos={pedidos} selecionado={atual.id} hoje={hoje} onSelecionar={selecionar} />
              <div ref={detalheRef} tabIndex={-1} className="min-w-0 outline-none">
                <Detalhe
                  key={`${atual.id}-${atual.versao}`}
                  pedido={atual}
                  equipes={listaEquipes}
                  onAtualizar={aoAtualizar}
                />
              </div>
            </div>
          );
        }}
      </EstadoDaTela>
    </>
  );
}

function Avatar({ nome, tamanho = "md" }: { nome: string; tamanho?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700",
        tamanho === "lg" ? "size-12 text-base" : "size-10 text-sm",
      )}
    >
      {iniciais(nome)}
    </span>
  );
}

function BadgePrazo({ pedido, hoje }: { pedido: PedidoVisao; hoje: string }) {
  if (!pedido.prazoEm) return null;
  const dia = pedido.prazoEm.slice(0, 10);
  if (dia < hoje) {
    return (
      <Badge tom="perigo" pontinho>
        Prazo vencido
      </Badge>
    );
  }
  return (
    <Badge tom="alerta" pontinho>
      Prazo até {dataCurta(dia)}
    </Badge>
  );
}

function Fila({
  pedidos,
  selecionado,
  hoje,
  onSelecionar,
}: {
  pedidos: PedidoVisao[];
  selecionado: number;
  hoje: string;
  onSelecionar: (id: number) => void;
}) {
  return (
    <Card>
      <CardHeader titulo={`Na fila: ${plural(pedidos.length, "pedido", "pedidos")}`} nivel="h2" />
      <ul className="divide-y divide-line" aria-label="Pedidos para aprovar">
        {pedidos.map((p) => {
          const ativo = p.id === selecionado;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelecionar(p.id)}
                aria-current={ativo ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition-colors",
                  ativo ? "border-brand-600 bg-brand-50" : "border-transparent hover:bg-muted",
                )}
              >
                <Avatar nome={p.pessoa.nome} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-strong">{p.pessoa.nome}</span>
                  <span className="block text-sm text-body">
                    {p.tipo} · {dataCurta(p.inicio)} a {dataCurta(p.fim)}
                  </span>
                  <span className="mt-1.5 block">
                    <BadgePrazo pedido={p} hoje={hoje} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Detalhe({
  pedido,
  equipes,
  onAtualizar,
}: {
  pedido: PedidoVisao;
  equipes: Equipe[];
  onAtualizar: (aviso?: string) => void;
}) {
  const { atual } = useAusencias();
  const buscar = React.useCallback(() => api.impacto(pedido.id), [pedido.id]);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  const equipe = equipes.find((e) => e.id === pedido.pessoa.equipeId);
  const nomeEquipe = equipe?.nome ?? (pedido.pessoa.equipeId === atual.equipeId ? atual.equipe : undefined);
  const minimo = equipe?.minimoPessoas ?? null;
  const impacto = estado.status === "pronto" ? estado.dados : null;
  const primeiro = primeiroNome(pedido.pessoa.nome);

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Avatar nome={pedido.pessoa.nome} tamanho="lg" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-strong">{pedido.pessoa.nome}</h2>
            <p className="text-sm text-soft">
              {[pedido.pessoa.funcao, nomeEquipe].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fato rotulo="Tipo" valor={pedido.tipo} />
          <Fato rotulo="Período" valor={periodo(pedido.inicio, pedido.fim)} />
          <Fato rotulo="Dias úteis" valor={String(pedido.diasUteis)} />
          {impacto && impacto.saldoAntes !== impacto.saldoDepois ? (
            <Fato rotulo="Saldo de dias" valor={`${impacto.saldoAntes} → ${impacto.saldoDepois}`} />
          ) : null}
          {impacto ? (
            <Fato
              rotulo="Fora nos últimos 12 meses"
              valor={plural(impacto.foraUltimos12Meses, "dia útil", "dias úteis")}
            />
          ) : null}
        </dl>

        {pedido.excedeSaldo ? (
          <Alert tipo="alerta">Este pedido usa mais dias do que o saldo disponível de {primeiro}.</Alert>
        ) : null}

        <section aria-labelledby={`grafico-${pedido.id}`}>
          <h3 id={`grafico-${pedido.id}`} className="mb-3 text-sm font-semibold text-strong">
            Pessoas trabalhando no pior dia de cada semana
          </h3>
          {estado.status === "carregando" ? (
            <Carregando rotulo="Calculando o impacto na equipe…" linhas={2} />
          ) : null}
          {estado.status === "erro" ? <ErroImpacto mensagem={estado.erro.mensagem} onTentarDeNovo={tentarDeNovo} /> : null}
          {impacto ? <GraficoSemanas semanas={impacto.semanas} minimo={minimo} /> : null}
        </section>

        {impacto ? <ForaNoPeriodo impacto={impacto} /> : null}

        <section aria-labelledby={`motivo-${pedido.id}`}>
          <h3 id={`motivo-${pedido.id}`} className="text-sm font-semibold text-strong">
            Motivo informado
          </h3>
          <p className="mt-1 text-sm text-body">{pedido.justificativa?.trim() ? pedido.justificativa : "Sem justificativa"}</p>
        </section>

        <DecisaoPedido pedido={pedido} alternativas={impacto?.alternativas ?? null} onAtualizar={onAtualizar} />
      </CardBody>
    </Card>
  );
}

function Fato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-soft">{rotulo}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-strong">{valor}</dd>
    </div>
  );
}

function ErroImpacto({ mensagem, onTentarDeNovo }: { mensagem: string; onTentarDeNovo: () => void }) {
  return (
    <Alert
      tipo="erro"
      titulo="Não foi possível calcular o impacto na equipe"
      acao={
        <Button variante="secondary" tamanho="sm" onClick={onTentarDeNovo}>
          Tentar de novo
        </Button>
      }
    >
      {mensagem}
    </Alert>
  );
}

function ForaNoPeriodo({ impacto }: { impacto: ImpactoPedidoVisao }) {
  return (
    <section aria-labelledby={`fora-${impacto.pedidoId}`}>
      <h3 id={`fora-${impacto.pedidoId}`} className="text-sm font-semibold text-strong">
        Também fora nesse período
      </h3>
      {impacto.tambemForaNoPeriodo.length === 0 ? (
        <p className="mt-1 text-sm text-body">Ninguém.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {impacto.tambemForaNoPeriodo.map((f) => (
            <li key={`${f.pessoa.id}-${f.inicio}`} className="flex items-center gap-2 text-sm text-body">
              <Avatar nome={f.pessoa.nome} />
              <span className="min-w-0">
                <span className="font-medium text-strong">{f.pessoa.nome}</span> · {dataCurta(f.inicio)} a {dataCurta(f.fim)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
