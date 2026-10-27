"use client";

/**
 * Grade pessoa × dia do mês. Tabela de verdade (leitor de tela entende linhas e
 * colunas); a rolagem horizontal fica DENTRO do container da grade.
 */
import * as React from "react";
import type { AusenciaCalendarioVisao, CalendarioVisao, DiaCalendarioVisao } from "@/lib/ausencias/visoes";
import { cn } from "@/lib/utils";
import { dataCurta, nomeDiaSemana, periodo } from "./formatos";

/** Faixa diagonal que marca "aguardando aprovação" (além do contorno tracejado). */
const LISTRADO = "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.65) 0 4px, transparent 4px 8px)";

type Celula =
  | { tipo: "vazio"; dia: DiaCalendarioVisao }
  | { tipo: "ausencia"; ausencia: AusenciaCalendarioVisao; dia: DiaCalendarioVisao; span: number };

function cobre(a: AusenciaCalendarioVisao, data: string): boolean {
  return a.inicio <= data && data <= a.fim;
}

function celulasDaPessoa(dias: DiaCalendarioVisao[], ausencias: AusenciaCalendarioVisao[]): Celula[] {
  const primeira = (data: string) => ausencias.find((a) => cobre(a, data));
  const celulas: Celula[] = [];
  let i = 0;
  while (i < dias.length) {
    const dia = dias[i];
    const a = primeira(dia.data);
    if (!a) {
      celulas.push({ tipo: "vazio", dia });
      i += 1;
      continue;
    }
    let span = 1;
    while (i + span < dias.length && primeira(dias[i + span].data) === a) span += 1;
    celulas.push({ tipo: "ausencia", ausencia: a, dia, span });
    i += span;
  }
  return celulas;
}

export function rotuloStatus(a: AusenciaCalendarioVisao): string {
  return a.pendente ? "Aguardando aprovação" : "Aprovado";
}

export interface GradeCalendarioProps {
  calendario: CalendarioVisao;
  selecionado: number | null;
  onSelecionar: (a: AusenciaCalendarioVisao) => void;
}

export function GradeCalendario({ calendario, selecionado, onSelecionar }: GradeCalendarioProps) {
  const { dias, pessoas, ausencias } = calendario;

  return (
    <div
      // Foco no container permite rolar com o teclado; a rolagem nunca vaza para a página.
      role="region"
      aria-label="Grade do calendário da equipe (role para o lado para ver todos os dias)"
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md border border-line"
    >
      <table className="border-separate border-spacing-0 text-xs">
        <caption className="sr-only">
          Ausências da equipe por dia. Cada linha é uma pessoa e cada coluna é um dia do mês.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 w-36 min-w-36 border-b border-r border-line bg-card px-3 py-2 text-left text-xs font-semibold text-soft sm:w-44 sm:min-w-44"
            >
              Pessoa
            </th>
            {dias.map((d) => (
              <th
                key={d.data}
                scope="col"
                title={d.feriado ? `${dataCurta(d.data)} · feriado` : undefined}
                className={cn(
                  "h-12 w-9 min-w-9 border-b border-l border-line px-0 text-center font-medium leading-tight",
                  d.util ? "bg-card text-strong" : "bg-muted text-soft",
                )}
              >
                <span className="block text-sm font-semibold">{d.data.slice(8)}</span>
                <span className="block text-[10px] font-normal">{nomeDiaSemana(d.data, true)}</span>
                {d.feriado ? <span className="sr-only"> (feriado)</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pessoas.map((p) => {
            const minhas = ausencias.filter((a) => a.pessoaId === p.id);
            const celulas = celulasDaPessoa(dias, minhas);
            return (
              <tr key={p.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 w-36 min-w-36 border-b border-r border-line bg-card px-3 py-1.5 text-left font-normal sm:w-44 sm:min-w-44"
                >
                  <span className="block truncate text-sm font-medium text-strong">{p.nome}</span>
                  {p.funcao ? <span className="block truncate text-xs text-soft">{p.funcao}</span> : null}
                </th>
                {celulas.map((c) =>
                  c.tipo === "vazio" ? (
                    <td
                      key={c.dia.data}
                      className={cn("h-12 border-b border-l border-line", !c.dia.util && "bg-muted")}
                    />
                  ) : (
                    <td key={c.dia.data} colSpan={c.span} className="h-12 border-b border-l border-line p-0.5">
                      <button
                        type="button"
                        onClick={() => onSelecionar(c.ausencia)}
                        aria-pressed={selecionado === c.ausencia.pedidoId}
                        aria-label={`${p.nome}: ${c.ausencia.rotulo}, ${periodo(c.ausencia.inicio, c.ausencia.fim)}, ${rotuloStatus(c.ausencia).toLowerCase()}. Ver detalhes`}
                        style={{
                          backgroundColor: c.ausencia.cor,
                          backgroundImage: c.ausencia.pendente ? LISTRADO : undefined,
                        }}
                        className={cn(
                          "flex h-full min-h-10 w-full items-center overflow-hidden rounded-sm px-1.5 text-left text-xs font-medium text-strong",
                          c.ausencia.pendente ? "border-2 border-dashed border-body" : "border border-transparent",
                          selecionado === c.ausencia.pedidoId && "ring-2 ring-brand-600 ring-offset-1",
                        )}
                      >
                        <span className="truncate">{c.ausencia.rotulo}</span>
                      </button>
                    </td>
                  ),
                )}
              </tr>
            );
          })}
          <tr>
            <th
              scope="row"
              className="sticky left-0 z-10 w-36 min-w-36 border-r border-line bg-card px-3 py-2 text-left text-xs font-semibold text-strong sm:w-44 sm:min-w-44"
            >
              Pessoas trabalhando
            </th>
            {dias.map((d) => (
              <td
                key={d.data}
                title={
                  d.util
                    ? `${dataCurta(d.data)}: ${d.trabalhando} trabalhando${d.abaixoDoMinimo ? " (abaixo do mínimo)" : ""}`
                    : undefined
                }
                className={cn(
                  "h-10 border-l border-line text-center text-xs",
                  !d.util && "bg-muted text-soft",
                  d.util && d.abaixoDoMinimo && "bg-danger-50 font-bold text-danger-700",
                  d.util && !d.abaixoDoMinimo && "font-medium text-strong",
                )}
              >
                {d.util ? (
                  <>
                    {d.abaixoDoMinimo ? <span aria-hidden="true">▼</span> : null}
                    {d.trabalhando}
                    <span className="sr-only">
                      {` pessoas trabalhando em ${dataCurta(d.data)}${d.abaixoDoMinimo ? ", abaixo do mínimo" : ""}`}
                    </span>
                  </>
                ) : (
                  <span aria-hidden="true">–</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function LegendaCalendario({ ausencias }: { ausencias: AusenciaCalendarioVisao[] }) {
  const tipos = new Map<string, string>();
  for (const a of ausencias) if (!tipos.has(a.rotulo)) tipos.set(a.rotulo, a.cor);
  return (
    <ul aria-label="Legenda" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-body">
      {[...tipos.entries()].map(([rotulo, cor]) => (
        <li key={rotulo} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-4 rounded-sm border border-transparent"
            style={{ backgroundColor: cor }}
          />
          {rotulo}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-4 rounded-sm border-2 border-dashed border-body bg-line-strong"
          style={{ backgroundImage: LISTRADO }}
        />
        Aguardando aprovação
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-4 rounded-sm border border-line bg-muted" />
        Fim de semana ou feriado
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="font-bold text-danger-700">
          ▼
        </span>
        Abaixo do mínimo de pessoas
      </li>
    </ul>
  );
}
