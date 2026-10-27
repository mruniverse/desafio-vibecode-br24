"use client";

/**
 * Gráfico de barras: pessoas trabalhando em cada dia útil do mês.
 * Sem biblioteca. Barras abaixo do mínimo ficam vermelhas E ganham o marcador ▼;
 * a tabela escondida (sr-only) é a alternativa para leitor de tela.
 */
import * as React from "react";
import type { DiaCalendarioVisao } from "@/lib/ausencias/visoes";
import { cn } from "@/lib/utils";
import { dataCurta, nomeDiaSemana } from "./formatos";

export function BarrasDisponibilidade({
  dias,
  minimo,
  totalMembros,
}: {
  dias: DiaCalendarioVisao[];
  minimo: number;
  totalMembros: number;
}) {
  const uteis = dias.filter((d) => d.util);
  const max = Math.max(1, totalMembros, minimo, ...uteis.map((d) => d.trabalhando));

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div aria-hidden="true" className="min-w-max">
          <div className="relative h-44 pt-6">
            <div className="relative h-full border-b border-line-strong">
              <div className="flex h-full items-end gap-1">
                {uteis.map((d) => (
                  <div key={d.data} className="relative h-full w-7">
                    <span
                      className={cn(
                        "absolute inset-x-0 pb-0.5 text-center text-[11px] leading-none",
                        d.abaixoDoMinimo ? "font-bold text-danger-700" : "font-medium text-strong",
                      )}
                      style={{ bottom: `${(d.trabalhando / max) * 100}%` }}
                    >
                      {d.trabalhando}
                    </span>
                    <div
                      className={cn(
                        "absolute inset-x-0 bottom-0 rounded-t-sm",
                        d.abaixoDoMinimo ? "bg-danger-500" : "bg-brand-500",
                      )}
                      style={{ height: `${(d.trabalhando / max) * 100}%`, minHeight: d.trabalhando > 0 ? 2 : 0 }}
                    />
                  </div>
                ))}
              </div>
              <div
                className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-body"
                style={{ bottom: `${(minimo / max) * 100}%` }}
              >
                <span className="absolute right-0 -top-5 rounded-sm bg-card px-1 text-xs font-medium text-body">
                  Mínimo: {minimo}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-1 flex gap-1">
            {uteis.map((d) => (
              <div key={d.data} className="w-7 text-center leading-tight">
                <span className="block text-xs font-semibold text-strong">{d.data.slice(8)}</span>
                <span className="block text-[10px] text-soft">{nomeDiaSemana(d.data, true)}</span>
                <span className="block h-4 text-xs font-bold text-danger-700">{d.abaixoDoMinimo ? "▼" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ul aria-label="Legenda do gráfico" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-body">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3.5 rounded-sm bg-brand-500" />
          Ok
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3.5 rounded-sm bg-danger-500" />
          <span aria-hidden="true" className="font-bold text-danger-700">
            ▼
          </span>
          Abaixo do mínimo
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-5 border-t-2 border-dashed border-body" />
          Mínimo: {minimo}
        </li>
      </ul>

      <table className="sr-only">
        <caption>Pessoas trabalhando em cada dia útil. O mínimo é de {minimo} pessoas.</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Pessoas trabalhando</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {uteis.map((d) => (
            <tr key={d.data}>
              <th scope="row">
                {nomeDiaSemana(d.data)}, {dataCurta(d.data)}
              </th>
              <td>{d.trabalhando}</td>
              <td>{d.abaixoDoMinimo ? "Abaixo do mínimo" : "Ok"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
