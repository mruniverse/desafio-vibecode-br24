"use client";

import * as React from "react";
import Link from "next/link";
import type { Equipe } from "@/lib/ausencias/tipos";
import type { DisponibilidadeVisao } from "@/lib/ausencias/visoes";
import { Alert, Button, Card, CardBody, CardHeader, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { BarrasDisponibilidade } from "./barras-disponibilidade";
import { useAusencias } from "./contexto";
import { EstadoDaTela, Vazio } from "./estados";
import { dataCurta, nomeMes, plural, primeiroDiaDoMes, ultimoDiaDoMes } from "./formatos";
import { Cabecalho, ComEquipes, equipePadrao, SeletorEquipeMes } from "./seletor-equipe";
import { useCarregar } from "./use-carregar";

const TITULO = "Equipe disponível";
const LIMITE_MINIMO = 500;

export function TelaEquipe() {
  return (
    <ComEquipes titulo={TITULO} subtitulo="Quantas pessoas estarão trabalhando em cada dia do mês.">
      {(equipes) => <PainelEquipe equipes={equipes} />}
    </ComEquipes>
  );
}

function PainelEquipe({ equipes }: { equipes: Equipe[] }) {
  const { hoje, atual } = useAusencias();
  const mesAtual = primeiroDiaDoMes(hoje);
  const [equipeId, setEquipeId] = React.useState(() => equipePadrao(equipes, atual.equipeId));
  const [mes, setMes] = React.useState(mesAtual);

  const ate = ultimoDiaDoMes(mes);
  const buscar = React.useCallback(() => api.disponibilidade(equipeId, mes, ate), [equipeId, mes, ate]);
  const { estado, recarregar, tentarDeNovo } = useCarregar(buscar);

  const equipe = equipes.find((e) => e.id === equipeId);
  const nomeDoMes = nomeMes(Number(mes.slice(5, 7)));
  const pronto = estado.status === "pronto" ? estado.dados : null;
  const ocupado = pronto !== null && (pronto.equipeId !== equipeId || pronto.dias[0]?.data.slice(0, 7) !== mes.slice(0, 7));
  const podeEditar = atual.papel === "admin" || (atual.papel === "gestor" && equipe?.gestorId === atual.id);

  const subtitulo =
    `Quantas pessoas estarão trabalhando em cada dia de ${nomeDoMes}.` +
    (equipe ? ` Equipe de ${equipe.nome}${pronto ? `, ${plural(pronto.totalMembros, "pessoa", "pessoas")}` : ""}.` : "");

  return (
    <>
      <Cabecalho titulo={TITULO} subtitulo={subtitulo} />
      <SeletorEquipeMes
        equipes={equipes}
        equipeId={equipeId}
        onEquipe={setEquipeId}
        mes={mes}
        onMes={setMes}
        mesAtual={mesAtual}
        ocupado={ocupado}
      />
      <div aria-busy={ocupado || undefined} className={ocupado ? "opacity-60 transition-opacity" : undefined}>
        <EstadoDaTela
          estado={estado}
          onTentarDeNovo={tentarDeNovo}
          rotuloCarregando="Carregando a disponibilidade da equipe…"
          vazio={(d) => d.totalMembros === 0}
          renderVazio={() => (
            <Vazio
              titulo="Esta equipe ainda não tem pessoas"
              descricao="Quando houver pessoas na equipe, você verá aqui quantas estarão trabalhando em cada dia."
            />
          )}
        >
          {(dados) => (
            <div className="flex flex-col gap-4">
              <Indicadores dados={dados} />
              <Card>
                <CardHeader titulo="Pessoas trabalhando por dia" nivel="h2" />
                <CardBody>
                  <BarrasDisponibilidade dias={dados.dias} minimo={dados.minimoPessoas} totalMembros={dados.totalMembros} />
                </CardBody>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Ajustes
                  key={`${dados.equipeId}-${dados.minimoPessoas}-${dados.contarPendentes}`}
                  dados={dados}
                  podeEditar={podeEditar}
                  onSalvo={recarregar}
                />
                <Atencao dados={dados} />
              </div>
            </div>
          )}
        </EstadoDaTela>
      </div>
    </>
  );
}

function Indicadores({ dados }: { dados: DisponibilidadeVisao }) {
  const uteis = dados.dias.filter((d) => d.util).length;
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <Kpi
        rotulo="Dias abaixo do mínimo"
        valor={String(dados.diasAbaixoDoMinimo)}
        apoio={`de ${plural(uteis, "dia útil", "dias úteis")}`}
        alerta={dados.diasAbaixoDoMinimo > 0}
      />
      <Kpi
        rotulo="Pior dia"
        valor={dados.piorDia ? dataCurta(dados.piorDia.data) : "—"}
        apoio={dados.piorDia ? `${dados.piorDia.trabalhando} trabalhando` : "Sem dias úteis neste mês"}
      />
      <Kpi rotulo="Mínimo" valor={String(dados.minimoPessoas)} apoio={dados.minimoPessoas === 1 ? "pessoa" : "pessoas"} />
    </dl>
  );
}

function Kpi({ rotulo, valor, apoio, alerta }: { rotulo: string; valor: string; apoio: string; alerta?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3 shadow-sm">
      <dt className="text-sm text-soft">{rotulo}</dt>
      <dd className={cn("mt-1 text-3xl font-bold", alerta ? "text-danger-700" : "text-strong")}>{valor}</dd>
      <dd className="text-sm text-body">{apoio}</dd>
    </div>
  );
}

function Ajustes({
  dados,
  podeEditar,
  onSalvo,
}: {
  dados: DisponibilidadeVisao;
  podeEditar: boolean;
  onSalvo: () => void;
}) {
  const toast = useToast();
  const [minimo, setMinimo] = React.useState(dados.minimoPessoas);
  const [contar, setContar] = React.useState(dados.contarPendentes);
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const idContar = React.useId();
  const mudou = minimo !== dados.minimoPessoas || contar !== dados.contarPendentes;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const r = await api.definirMinimo(dados.equipeId, { minimoPessoas: minimo, contarPendentes: contar });
    setSalvando(false);
    if (!r.ok) {
      const msg = r.erro.campos?.minimoPessoas ?? r.erro.mensagem;
      setErro(msg);
      toast.erro("Não foi possível salvar os ajustes.", { descricao: msg });
      return;
    }
    toast.sucesso("Ajustes salvos.", {
      descricao: `Mínimo de ${plural(r.dados.minimoPessoas, "pessoa", "pessoas")} trabalhando.`,
    });
    onSalvo();
  }

  return (
    <Card>
      <CardHeader titulo="Ajustes" nivel="h2" />
      <CardBody className="flex flex-col gap-5">
        {!podeEditar ? (
          <p className="text-sm text-soft">Só o gestor da equipe ou a administração pode mudar estes ajustes.</p>
        ) : null}

        <div>
          <p id={`${idContar}-minimo`} className="text-sm font-medium text-strong">
            Mínimo de pessoas trabalhando
          </p>
          <div className="mt-2 flex items-center gap-3" role="group" aria-labelledby={`${idContar}-minimo`}>
            <Button
              variante="secondary"
              aria-label="Diminuir o mínimo"
              disabled={!podeEditar || salvando || minimo <= 1}
              onClick={() => setMinimo((n) => Math.max(1, n - 1))}
              className="w-11 px-0 text-lg"
            >
              −
            </Button>
            <output aria-live="polite" className="min-w-10 text-center text-2xl font-bold text-strong">
              {minimo}
            </output>
            <Button
              variante="secondary"
              aria-label="Aumentar o mínimo"
              disabled={!podeEditar || salvando || minimo >= LIMITE_MINIMO}
              onClick={() => setMinimo((n) => Math.min(LIMITE_MINIMO, n + 1))}
              className="w-11 px-0 text-lg"
            >
              +
            </Button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p id={idContar} className="text-sm font-medium text-strong">
              Contar pedidos ainda não aprovados
            </p>
            <p id={`${idContar}-ajuda`} className="mt-1 text-sm text-soft">
              Mostra como fica a equipe se você aprovar tudo o que está pendente.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span aria-hidden="true" className="w-16 text-right text-sm text-body">
              {contar ? "Ligado" : "Desligado"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={contar}
              aria-labelledby={idContar}
              aria-describedby={`${idContar}-ajuda`}
              disabled={!podeEditar || salvando}
              onClick={() => setContar((v) => !v)}
              className="flex items-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative inline-block h-6 w-11 rounded-full border transition-colors",
                  contar ? "border-brand-600 bg-brand-600" : "border-line-strong bg-muted",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-5 rounded-full bg-card shadow-sm transition-[left]",
                    contar ? "left-[1.375rem]" : "left-0.5",
                  )}
                />
              </span>
            </button>
          </div>
        </div>

        {podeEditar ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void salvar()} loading={salvando} disabled={!mudou}>
                Salvar ajustes
              </Button>
              {mudou && !salvando ? <span className="text-sm text-soft">Você mudou algo e ainda não salvou.</span> : null}
            </div>
            {erro ? <p className="text-sm font-medium text-danger-700">{erro}</p> : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Atencao({ dados }: { dados: DisponibilidadeVisao }) {
  return (
    <Card>
      <CardHeader titulo="O que precisa de atenção" nivel="h2" />
      <CardBody>
        {dados.atencao.length === 0 ? (
          <Alert tipo="sucesso">Tudo certo. A equipe fica acima do mínimo em todos os dias.</Alert>
        ) : (
          <ul className="flex flex-col gap-3">
            {dados.atencao.map((a) => (
              <li
                key={a.pedidoId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-500 bg-warning-50 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 text-sm text-body">{a.texto}</span>
                <Link
                  href="/ausencias/aprovar"
                  className="br24-tap inline-flex items-center rounded-sm px-2 text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
                >
                  Ver pedido
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
