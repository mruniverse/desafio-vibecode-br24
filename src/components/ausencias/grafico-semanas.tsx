"use client";

/**
 * Gráfico "Pessoas trabalhando no pior dia de cada semana": para cada semana,
 * duas barras (sem o pedido / se aprovar) com o valor escrito, e a linha tracejada
 * do mínimo. Abaixo do mínimo = vermelho + ▼ + texto "Abaixo do mínimo".
 * A tabela escondida (sr-only) é a alternativa em texto para leitor de tela.
 */
import * as React from "react";
import type { SemanaPiorDiaVisao } from "@/lib/ausencias/visoes";
import { cn } from "@/lib/utils";
import { dataCurta } from "./formatos";

const LARGURA_SEMANA = "5.75rem";

function Barra({ valor, max, abaixo, tipo }: { valor: number; max: number; abaixo: boolean; tipo: "sem" | "com" }) {
  const altura = `${(valor / max) * 100}%`;
  return (
    <div className="relative h-full w-9">
      <span
        className={cn(
          "absolute inset-x-0 pb-0.5 text-center text-xs leading-none",
          abaixo ? "font-bold text-danger-700" : "font-semibold text-strong",
        )}
        style={{ bottom: altura }}
      >
        {abaixo ? "▼" : ""}
        {valor}
      </span>
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 rounded-t-sm",
          tipo === "sem" && !abaixo && "border border-brand-500 bg-brand-200",
          tipo === "sem" && abaixo && "border-2 border-danger-500 bg-danger-50",
          tipo === "com" && !abaixo && "bg-brand-600",
          tipo === "com" && abaixo && "bg-danger-500",
        )}
        style={{ height: altura, minHeight: valor > 0 ? 2 : 0 }}
      />
    </div>
  );
}

export function GraficoSemanas({ semanas, minimo }: { semanas: SemanaPiorDiaVisao[]; minimo: number | null }) {
  if (semanas.length === 0) {
    return <p className="text-sm text-soft">Não há dias úteis neste período para comparar.</p>;
  }
  const max = Math.max(1, minimo ?? 0, ...semanas.flatMap((s) => [s.semPedido, s.comPedido]));
  const colunas = `repeat(${semanas.length}, minmax(${LARGURA_SEMANA}, 1fr))`;
  const larguraMinima = `calc(${semanas.length} * ${LARGURA_SEMANA})`;
  const semanasAbaixo = minimo === null ? 0 : semanas.filter((s) => s.comPedido < minimo).length;

  return (
    <div>
      {minimo !== null && semanasAbaixo > 0 ? (
        <p className="mb-2 text-sm font-semibold text-danger-700">
          <span aria-hidden="true">▼ </span>
          Se aprovar, a equipe fica abaixo do mínimo em {semanasAbaixo} {semanasAbaixo === 1 ? "semana" : "semanas"}.
        </p>
      ) : null}

      <div className="overflow-x-auto pb-1">
        <div aria-hidden="true" style={{ minWidth: larguraMinima }}>
          <div className="relative h-44 pt-6">
            <div className="relative h-full border-b border-line-strong">
              <div className="grid h-full" style={{ gridTemplateColumns: colunas }}>
                {semanas.map((s) => (
                  <div key={s.semanaInicio} className="flex h-full items-end justify-center gap-1.5">
                    <Barra
                      valor={s.semPedido}
                      max={max}
                      abaixo={minimo !== null && s.semPedido < minimo}
                      tipo="sem"
                    />
                    <Barra
                      valor={s.comPedido}
                      max={max}
                      abaixo={minimo !== null && s.comPedido < minimo}
                      tipo="com"
                    />
                  </div>
                ))}
              </div>
              {minimo !== null ? (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-body"
                  style={{ bottom: `${(minimo / max) * 100}%` }}
                >
                  <span className="absolute right-0 -top-5 rounded-sm bg-card px-1 text-xs font-medium text-body">
                    Mínimo: {minimo} {minimo === 1 ? "pessoa" : "pessoas"}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-1 grid" style={{ gridTemplateColumns: colunas }}>
            {semanas.map((s) => {
              const abaixo = minimo !== null && s.comPedido < minimo;
              return (
                <div key={s.semanaInicio} className="px-1 text-center leading-tight">
                  <span className="block text-xs font-semibold text-strong">Semana de {dataCurta(s.semanaInicio)}</span>
                  {minimo !== null ? (
                    <span className={cn("block text-xs", abaixo ? "font-bold text-danger-700" : "text-soft")}>
                      {abaixo ? "▼ Abaixo do mínimo" : "Ok"}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ul aria-label="Legenda do gráfico" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-body">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3.5 rounded-sm border border-brand-500 bg-brand-200" />
          Sem este pedido
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3.5 rounded-sm bg-brand-600" />
          Se aprovar
        </li>
        {minimo !== null ? (
          <>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3.5 rounded-sm bg-danger-500" />
              <span aria-hidden="true" className="font-bold text-danger-700">
                ▼
              </span>
              Abaixo do mínimo
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-5 border-t-2 border-dashed border-body" />
              Mínimo: {minimo} {minimo === 1 ? "pessoa" : "pessoas"}
            </li>
          </>
        ) : null}
      </ul>

      <table className="sr-only">
        <caption>
          Pessoas trabalhando no pior dia de cada semana{minimo !== null ? `. O mínimo é de ${minimo} pessoas` : ""}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col">Sem este pedido</th>
            <th scope="col">Se aprovar</th>
            {minimo !== null ? <th scope="col">Situação se aprovar</th> : null}
          </tr>
        </thead>
        <tbody>
          {semanas.map((s) => (
            <tr key={s.semanaInicio}>
              <th scope="row">Semana de {dataCurta(s.semanaInicio)}</th>
              <td>{s.semPedido}</td>
              <td>{s.comPedido}</td>
              {minimo !== null ? <td>{s.comPedido < minimo ? "Abaixo do mínimo" : "Ok"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
