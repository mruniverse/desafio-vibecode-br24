"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Skeleton,
  useToast,
} from "@/components/ui";
import type { BadgeTom } from "@/components/ui";
import type { PainelVisao, PedidoVisao } from "@/lib/ausencias/visoes";
import { cn } from "@/lib/utils";
import { Seletor } from "./abas";
import { api } from "./api";
import { useAusencias } from "./contexto";
import { ErroTela, EstadoDaTela } from "./estados";
import {
  dataCurta,
  dataDoInstante,
  horasLegiveis,
  periodo,
  plural,
  porcentagem,
  iniciais,
} from "./formatos";
import { useCarregar } from "./use-carregar";

/* -------------------------------------------------------------------------- */
/* Peças                                                                      */
/* -------------------------------------------------------------------------- */

type TomKpi = "normal" | "alerta";

function Kpi({
  rotulo,
  valor,
  detalhe,
  tom = "normal",
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: TomKpi;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 shadow-sm",
        tom === "alerta" ? "border-warning-500 bg-warning-50" : "border-line bg-card",
      )}
    >
      <p className={cn("text-sm font-medium", tom === "alerta" ? "text-warning-700" : "text-soft")}>{rotulo}</p>
      <p className={cn("mt-1 text-3xl font-semibold", tom === "alerta" ? "text-warning-700" : "text-strong")}>{valor}</p>
      {detalhe ? <p className="mt-1 text-sm text-soft">{detalhe}</p> : null}
    </div>
  );
}

interface ItemBarra {
  chave: string;
  rotulo: string;
  valor: number;
}

/** Barras simples: o número sempre aparece em texto, a barra só reforça. */
function Barras({ itens, unidade, tom = "marca" }: { itens: ItemBarra[]; unidade: string; tom?: "marca" | "alerta" }) {
  const maximo = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="flex flex-col gap-3">
      {itens.map((item) => (
        <li key={item.chave}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-body">{item.rotulo}</span>
            <span className="shrink-0 font-medium text-strong">
              {item.valor} {unidade}
            </span>
          </div>
          <div aria-hidden="true" className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-muted">
            <div
              className={cn("h-full rounded-sm", tom === "alerta" ? "bg-warning-500" : "bg-brand-500")}
              style={{ width: `${Math.max(4, Math.round((item.valor / maximo) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const STATUS: { chave: keyof PainelVisao["porStatus"]; rotulo: string; tom: BadgeTom }[] = [
  { chave: "pendente", rotulo: "Em análise", tom: "alerta" },
  { chave: "aprovada", rotulo: "Aprovados", tom: "sucesso" },
  { chave: "recusada", rotulo: "Recusados", tom: "perigo" },
  { chave: "cancelada", rotulo: "Cancelados", tom: "neutro" },
];

/* -------------------------------------------------------------------------- */
/* Indicadores                                                                */
/* -------------------------------------------------------------------------- */

function Indicadores({ equipeId }: { equipeId: string }) {
  const buscar = React.useCallback(() => api.painel(equipeId || undefined), [equipeId]);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  return (
    <EstadoDaTela estado={estado} onTentarDeNovo={tentarDeNovo} rotuloCarregando="Carregando os indicadores…">
      {(p) => <IndicadoresPronto painel={p} />}
    </EstadoDaTela>
  );
}

function IndicadoresPronto({ painel: p }: { painel: PainelVisao }) {
  const tiposBarras: ItemBarra[] = p.diasPorTipo.map((t) => ({ chave: t.rotulo, rotulo: t.rotulo, valor: t.dias }));
  const minimoBarras: ItemBarra[] = p.diasAbaixoDoMinimoPorEquipe
    .filter((e) => e.dias > 0)
    .map((e) => ({ chave: e.equipeId, rotulo: e.nome, valor: e.dias }));
  const atrasados = p.aguardandoGestor.atrasados;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Aguardando o gestor"
          valor={String(p.aguardandoGestor.total)}
          detalhe={p.aguardandoGestor.total === 1 ? "pedido em análise" : "pedidos em análise"}
        />
        <Kpi
          rotulo="Atrasados"
          valor={String(atrasados)}
          tom={atrasados > 0 ? "alerta" : "normal"}
          detalhe={atrasados > 0 ? "passaram do prazo do gestor" : "nenhum fora do prazo"}
        />
        <Kpi rotulo="Taxa de aprovação" valor={porcentagem(p.taxaAprovacao)} detalhe="dos pedidos já decididos" />
        <Kpi rotulo="Tempo médio de decisão" valor={horasLegiveis(p.tempoMedioDecisaoHoras)} detalhe="do pedido até a resposta" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader nivel="h3" titulo="Dias de ausência por tipo" descricao="Próximos 90 dias." />
          <CardBody>
            {tiposBarras.length === 0 ? (
              <p className="text-sm text-soft">Nenhuma ausência marcada nos próximos 90 dias.</p>
            ) : (
              <Barras itens={tiposBarras} unidade="dias" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            nivel="h3"
            titulo="Dias abaixo do mínimo por equipe"
            descricao="Dias úteis em que a equipe fica com menos gente que o mínimo. Próximos 90 dias."
          />
          <CardBody>
            {minimoBarras.length === 0 ? (
              <p className="text-sm text-soft">Nenhuma equipe fica abaixo do mínimo nos próximos 90 dias.</p>
            ) : (
              <Barras itens={minimoBarras} unidade="dias" tom="alerta" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader nivel="h3" titulo="Férias vencendo" descricao="Saldo que vence nos próximos 90 dias." />
          <CardBody>
            {p.feriasVencendo.length === 0 ? (
              <p className="text-sm text-soft">Ninguém tem férias vencendo nos próximos 90 dias.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {p.feriasVencendo.map((f) => (
                  <li key={`${f.pessoa.id}-${f.venceEm}`} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700"
                    >
                      {iniciais(f.pessoa.nome)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-strong">{f.pessoa.nome}</p>
                      <p className="text-sm text-soft">
                        {plural(f.dias, "dia", "dias")} · vencem em {dataCurta(f.venceEm)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader nivel="h3" titulo="Pedidos por status" />
          <CardBody>
            <ul className="grid grid-cols-2 gap-3">
              {STATUS.map((s) => (
                <li key={s.chave} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                  <Badge tom={s.tom} pontinho>
                    {s.rotulo}
                  </Badge>
                  <span className="text-lg font-semibold text-strong">{p.porStatus[s.chave]}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pedidos aguardando o gestor                                                */
/* -------------------------------------------------------------------------- */

function PedidosAguardando({ equipeId, nomeEquipe }: { equipeId: string; nomeEquipe: string | null }) {
  const buscar = React.useCallback(() => api.paraAprovar(), []);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  return (
    <Card>
      <CardHeader
        nivel="h3"
        titulo="Pedidos aguardando o gestor"
        descricao="Quando aprovados, vão direto para o Gráfico de Ausências do Bitrix24."
      />
      {estado.status === "carregando" ? (
        <CardBody aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
          <span className="sr-only">Carregando os pedidos…</span>
          <Skeleton altura="3rem" />
          <Skeleton altura="3rem" />
        </CardBody>
      ) : null}
      {estado.status === "erro" ? (
        <CardBody>
          <ErroTela erro={estado.erro} onTentarDeNovo={tentarDeNovo} />
        </CardBody>
      ) : null}
      {estado.status === "pronto" ? (
        <ListaAguardando pedidos={estado.dados} equipeId={equipeId} nomeEquipe={nomeEquipe} />
      ) : null}
    </Card>
  );
}

function ListaAguardando({
  pedidos,
  equipeId,
  nomeEquipe,
}: {
  pedidos: PedidoVisao[];
  equipeId: string;
  nomeEquipe: string | null;
}) {
  const { hoje } = useAusencias();
  const toast = useToast();
  const [lembrados, setLembrados] = React.useState<ReadonlySet<number>>(new Set());
  const [enviando, setEnviando] = React.useState<number | null>(null);

  async function lembrar(pedido: PedidoVisao) {
    setEnviando(pedido.id);
    const r = await api.lembrar(pedido.id);
    setEnviando(null);
    if (r.ok) {
      setLembrados((atual) => new Set(atual).add(pedido.id));
      toast.sucesso("Lembrete enviado", {
        descricao: pedido.aprovador ? `${pedido.aprovador.nome} foi avisado(a).` : "O gestor foi avisado.",
      });
    } else {
      toast.erro("Não foi possível lembrar o gestor", { descricao: r.erro.mensagem });
    }
  }

  const lista = equipeId ? pedidos.filter((p) => p.pessoa.equipeId === equipeId) : pedidos;
  if (lista.length === 0) {
    return (
      <EmptyState
        titulo={equipeId ? "Nenhum pedido aguardando nesta equipe." : "Nenhum pedido aguardando o gestor."}
        descricao={equipeId && nomeEquipe ? `Equipe ${nomeEquipe}: tudo respondido por enquanto.` : "Tudo respondido por enquanto."}
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {lista.map((p) => {
        const atrasado = p.prazoEm ? dataDoInstante(p.prazoEm) < hoje : false;
        const ja = lembrados.has(p.id);
        return (
          <li key={p.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700"
              >
                {iniciais(p.pessoa.nome)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-strong">
                  {p.pessoa.nome}
                  {atrasado ? (
                    <Badge tom="alerta" pontinho className="ml-2 align-middle">
                      Atrasado
                    </Badge>
                  ) : null}
                </p>
                <p className="text-sm text-soft">
                  {p.tipo} · {periodo(p.inicio, p.fim)} · {plural(p.diasUteis, "dia útil", "dias úteis")}
                </p>
                <p className="text-sm text-soft">
                  Gestor: {p.aprovador ? p.aprovador.nome : "não definido"}
                  {p.prazoEm ? ` · prazo ${dataCurta(dataDoInstante(p.prazoEm))}` : ""}
                </p>
              </div>
            </div>
            <Button
              variante="secondary"
              tamanho="sm"
              disabled={ja}
              loading={enviando === p.id}
              onClick={() => void lembrar(p)}
              aria-label={ja ? `Lembrete enviado sobre o pedido de ${p.pessoa.nome}` : `Lembrar gestor sobre o pedido de ${p.pessoa.nome}`}
            >
              {ja ? "Lembrete enviado" : "Lembrar gestor"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Aba                                                                        */
/* -------------------------------------------------------------------------- */

export function PainelAdmin() {
  const [equipeId, setEquipeId] = React.useState("");
  const buscarEquipes = React.useCallback(() => api.equipes(), []);
  const { estado: equipes } = useCarregar(buscarEquipes);
  const lista = equipes.status === "pronto" ? equipes.dados : [];
  const nomeEquipe = lista.find((e) => e.id === equipeId)?.nome ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-soft">
          Pedidos, aprovações e ausências {nomeEquipe ? `da equipe ${nomeEquipe}` : "da empresa"} nos próximos 90 dias.
        </p>
        <Seletor
          rotulo="Equipe"
          value={equipeId}
          onChange={(e) => setEquipeId(e.target.value)}
          classNameRaiz="sm:w-56"
        >
          <option value="">Todas</option>
          {lista.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </Seletor>
      </div>

      {/* A chave refaz a busca (e mostra o esqueleto) quando a equipe muda. */}
      <Indicadores key={equipeId} equipeId={equipeId} />
      <PedidosAguardando equipeId={equipeId} nomeEquipe={nomeEquipe} />
    </div>
  );
}
