"use client";

/**
 * Peças compartilhadas pelas telas de Calendário e Equipe disponível:
 * cabeçalho da tela, carregamento da lista de equipes e a barra
 * "equipe + mês" (com ‹ mês ›).
 */
import * as React from "react";
import type { Equipe } from "@/lib/ausencias/tipos";
import { Button } from "@/components/ui";
import { api } from "./api";
import { Carregando, ErroTela, Vazio } from "./estados";
import { mesPorExtenso, primeiroDiaDoMes, somarMeses } from "./formatos";
import { useCarregar } from "./use-carregar";

export function Cabecalho({ titulo, subtitulo }: { titulo: string; subtitulo?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold text-strong">{titulo}</h1>
      {subtitulo ? <p className="mt-1 text-sm text-body">{subtitulo}</p> : null}
    </div>
  );
}

/** "novembro de 2026" -> "Novembro de 2026". */
export function mesComMaiuscula(mes: string): string {
  const t = mesPorExtenso(mes);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Equipe que abre por padrão: a da pessoa logada, se estiver na lista; senão a primeira. */
export function equipePadrao(equipes: Equipe[], equipeDaPessoa: string): string {
  return equipes.find((e) => e.id === equipeDaPessoa)?.id ?? equipes[0]?.id ?? "";
}

/**
 * Carrega as equipes que a pessoa pode ver e só então desenha `children`.
 * Enquanto carrega, em erro (ex.: 403) ou sem nenhuma equipe, mostra o
 * cabeçalho estático + o estado correspondente.
 */
export function ComEquipes({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo: string;
  children: (equipes: Equipe[]) => React.ReactNode;
}) {
  const { estado, tentarDeNovo } = useCarregar(api.equipes);

  if (estado.status !== "pronto") {
    return (
      <>
        <Cabecalho titulo={titulo} subtitulo={subtitulo} />
        {estado.status === "carregando" ? (
          <Carregando rotulo="Carregando a equipe…" />
        ) : (
          <ErroTela erro={estado.erro} onTentarDeNovo={tentarDeNovo} />
        )}
      </>
    );
  }
  if (estado.dados.length === 0) {
    return (
      <>
        <Cabecalho titulo={titulo} subtitulo={subtitulo} />
        <Vazio titulo="Nenhuma equipe disponível" descricao="Você ainda não gerencia nenhuma equipe." />
      </>
    );
  }
  return <>{children(estado.dados)}</>;
}

export interface SeletorEquipeMesProps {
  equipes: Equipe[];
  equipeId: string;
  onEquipe: (id: string) => void;
  /** Primeiro dia do mês exibido (AAAA-MM-01). */
  mes: string;
  onMes: (mes: string) => void;
  /** Primeiro dia do mês de "hoje" (para o atalho "Mês atual"). */
  mesAtual: string;
  ocupado?: boolean;
}

export function SeletorEquipeMes({ equipes, equipeId, onEquipe, mes, onMes, mesAtual, ocupado }: SeletorEquipeMesProps) {
  const nomeEquipe = equipes.find((e) => e.id === equipeId)?.nome ?? "";
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1" role="group" aria-label="Escolher o mês">
        <Button
          variante="secondary"
          tamanho="sm"
          aria-label="Mês anterior"
          onClick={() => onMes(somarMeses(mes, -1))}
          className="w-10 px-0"
        >
          ‹
        </Button>
        <p
          aria-live="polite"
          aria-busy={ocupado || undefined}
          className="min-w-40 px-2 text-center text-base font-semibold text-strong"
        >
          {mesComMaiuscula(mes)}
        </p>
        <Button
          variante="secondary"
          tamanho="sm"
          aria-label="Próximo mês"
          onClick={() => onMes(somarMeses(mes, 1))}
          className="w-10 px-0"
        >
          ›
        </Button>
        {mes !== primeiroDiaDoMes(mesAtual) ? (
          <Button variante="ghost" tamanho="sm" onClick={() => onMes(primeiroDiaDoMes(mesAtual))}>
            Mês atual
          </Button>
        ) : null}
      </div>
      {equipes.length > 1 ? (
        <label className="flex items-center gap-2 text-sm text-soft">
          <span>Equipe</span>
          <select
            value={equipeId}
            onChange={(e) => onEquipe(e.target.value)}
            className="h-11 min-h-11 rounded-md border border-line bg-card px-2 text-sm text-strong"
          >
            {equipes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-soft">
          Equipe: <strong className="text-strong">{nomeEquipe}</strong>
        </p>
      )}
    </div>
  );
}
