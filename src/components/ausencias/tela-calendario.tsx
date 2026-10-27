"use client";

import * as React from "react";
import Link from "next/link";
import type { Equipe } from "@/lib/ausencias/tipos";
import type { AusenciaCalendarioVisao, CalendarioVisao } from "@/lib/ausencias/visoes";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { api } from "./api";
import { useAusencias } from "./contexto";
import { EstadoDaTela, Vazio } from "./estados";
import { mesPorExtenso, periodo, primeiroDiaDoMes, ultimoDiaDoMes } from "./formatos";
import { GradeCalendario, LegendaCalendario, rotuloStatus } from "./grade-calendario";
import { Cabecalho, ComEquipes, equipePadrao, SeletorEquipeMes } from "./seletor-equipe";
import { useCarregar } from "./use-carregar";

const TITULO = "Calendário da equipe";

export function TelaCalendario() {
  return (
    <ComEquipes titulo={TITULO} subtitulo="Veja quem está ausente em cada dia do mês.">
      {(equipes) => <PainelCalendario equipes={equipes} />}
    </ComEquipes>
  );
}

function PainelCalendario({ equipes }: { equipes: Equipe[] }) {
  const { hoje, atual } = useAusencias();
  const mesAtual = primeiroDiaDoMes(hoje);
  const [equipeId, setEquipeId] = React.useState(() => equipePadrao(equipes, atual.equipeId));
  const [mes, setMes] = React.useState(mesAtual);
  const [selecionado, setSelecionado] = React.useState<number | null>(null);

  const ate = ultimoDiaDoMes(mes);
  const buscar = React.useCallback(() => api.calendario(equipeId, mes, ate), [equipeId, mes, ate]);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  const equipe = equipes.find((e) => e.id === equipeId);
  const ocupado = estado.status === "pronto" && (estado.dados.de !== mes || estado.dados.equipeId !== equipeId);

  function mudarMes(novo: string) {
    setSelecionado(null);
    setMes(novo);
  }
  function mudarEquipe(id: string) {
    setSelecionado(null);
    setEquipeId(id);
  }

  return (
    <>
      <Cabecalho
        titulo={TITULO}
        subtitulo={`Veja quem está ausente em cada dia do mês.${equipe ? ` Equipe de ${equipe.nome}.` : ""}`}
      />
      <SeletorEquipeMes
        equipes={equipes}
        equipeId={equipeId}
        onEquipe={mudarEquipe}
        mes={mes}
        onMes={mudarMes}
        mesAtual={mesAtual}
        ocupado={ocupado}
      />
      <div aria-busy={ocupado || undefined} className={ocupado ? "opacity-60 transition-opacity" : undefined}>
        <EstadoDaTela
          estado={estado}
          onTentarDeNovo={tentarDeNovo}
          rotuloCarregando="Carregando o calendário…"
          vazio={(d) => d.ausencias.length === 0}
          renderVazio={() => (
            <Vazio
              titulo={`Ninguém ausente em ${mesPorExtenso(mes)}`}
              descricao="Todas as pessoas da equipe estão disponíveis neste mês. Use as setas para ver outros meses."
            />
          )}
        >
          {(dados) => (
            <Card>
              <CardBody>
                <GradeCalendario
                  calendario={dados}
                  selecionado={selecionado}
                  onSelecionar={(a) => setSelecionado(a.pedidoId)}
                />
                <LegendaCalendario ausencias={dados.ausencias} />
                <Detalhe
                  calendario={dados}
                  selecionado={selecionado}
                  onFechar={() => setSelecionado(null)}
                  podeAbrirPedido={atual.papel === "gestor" || atual.papel === "admin"}
                />
              </CardBody>
            </Card>
          )}
        </EstadoDaTela>
      </div>
    </>
  );
}

function Detalhe({
  calendario,
  selecionado,
  onFechar,
  podeAbrirPedido,
}: {
  calendario: CalendarioVisao;
  selecionado: number | null;
  onFechar: () => void;
  podeAbrirPedido: boolean;
}) {
  const ausencia: AusenciaCalendarioVisao | undefined = calendario.ausencias.find((a) => a.pedidoId === selecionado);
  const pessoa = ausencia ? calendario.pessoas.find((p) => p.id === ausencia.pessoaId) : undefined;

  return (
    <div aria-live="polite" className="mt-4">
      {ausencia && pessoa ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-muted px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-strong">{pessoa.nome}</p>
            <p className="mt-0.5 text-sm text-body">
              {ausencia.rotulo} · {periodo(ausencia.inicio, ausencia.fim)}
            </p>
            <div className="mt-2">
              <Badge tom={ausencia.pendente ? "alerta" : "sucesso"} pontinho>
                {ausencia.pendente ? "Pendente" : "Aprovado"}
              </Badge>
              <span className="sr-only"> ({rotuloStatus(ausencia)})</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {podeAbrirPedido && ausencia.pendente ? (
              <Link
                href="/ausencias/aprovar"
                className="br24-tap inline-flex items-center rounded-sm border border-line-strong bg-card px-3 text-sm font-medium text-strong shadow-sm hover:bg-muted"
              >
                Abrir pedido
              </Link>
            ) : null}
            <Button variante="ghost" tamanho="sm" onClick={onFechar}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-soft">Toque numa ausência para ver os detalhes.</p>
      )}
    </div>
  );
}
