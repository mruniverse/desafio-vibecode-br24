import * as React from "react";

import { cn } from "@/lib/utils";

export interface Etapa {
  id: string;
  titulo: string;
  descricao?: string;
}

export interface StepperProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  etapas: Etapa[];
  /** Indice da etapa atual (base 0). */
  atual: number;
  /** Indices das etapas ja concluidas. */
  concluidas?: number[];
  rotulo?: string;
}

function IconeCheck() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className="size-4"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a.75.75 0 0 1 .006 1.06l-7.25 7.5a.75.75 0 0 1-1.07.01L4.29 10.03a.75.75 0 1 1 1.06-1.06l3.03 3.03 6.72-6.95a.75.75 0 0 1 1.604.24Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

type EstadoEtapa = "concluida" | "atual" | "futura";

const BOLHA: Record<EstadoEtapa, string> = {
  concluida: "bg-brand-600 text-white",
  atual: "bg-brand-50 text-brand-700 ring-2 ring-brand-500",
  futura: "bg-muted text-soft",
};

const TITULO: Record<EstadoEtapa, string> = {
  concluida: "text-body",
  atual: "text-strong",
  futura: "text-soft",
};

/**
 * Trilha de progresso do wizard. No desktop mostra todas as etapas; no mobile
 * cai para "Etapa X de N" + barra, porque trilha horizontal em tela estreita
 * vira texto ilegivel ou rolagem lateral (proibida dentro do iframe).
 */
export function Stepper({
  etapas,
  atual,
  concluidas = [],
  rotulo = "Progresso da configuração",
  className,
  ...resto
}: StepperProps) {
  const total = etapas.length;
  if (total === 0) return null;

  const indiceAtual = Math.min(Math.max(atual, 0), total - 1);
  const feitas = new Set(concluidas);

  function estadoDe(i: number): EstadoEtapa {
    if (feitas.has(i)) return "concluida";
    if (i === indiceAtual) return "atual";
    return "futura";
  }

  const etapaAtual = etapas[indiceAtual];
  // Conta a atual como "em andamento": barra nunca fica em 0%, o que daria a
  // impressao de que nada aconteceu ainda.
  const pct = Math.round(((feitas.size + 0.5) / total) * 100);

  return (
    <nav
      {...resto}
      aria-label={rotulo}
      className={cn("w-full", className)}
    >
      {/* ---------------- mobile: resumo + barra ---------------- */}
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-strong">
            {etapaAtual.titulo}
          </p>
          <p className="shrink-0 text-xs font-medium text-soft">
            Etapa {indiceAtual + 1} de {total}
          </p>
        </div>
        {etapaAtual.descricao ? (
          <p className="mt-0.5 text-xs text-soft">{etapaAtual.descricao}</p>
        ) : null}
        <div
          className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(pct, 100)}
          aria-valuetext={`Etapa ${indiceAtual + 1} de ${total}`}
        >
          <div
            className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      {/* ---------------- desktop: trilha completa ---------------- */}
      <ol className="hidden sm:flex sm:items-start">
        {etapas.map((etapa, i) => {
          const estado = estadoDe(i);
          const ultima = i === total - 1;

          return (
            <li
              key={etapa.id}
              aria-current={estado === "atual" ? "step" : undefined}
              className={cn("flex min-w-0", !ultima && "flex-1")}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors duration-200",
                    BOLHA[estado],
                  )}
                >
                  {estado === "concluida" ? <IconeCheck /> : i + 1}
                  <span className="sr-only">
                    {estado === "concluida"
                      ? " (concluída)"
                      : estado === "atual"
                        ? " (etapa atual)"
                        : " (pendente)"}
                  </span>
                </span>
                <div className="min-w-0 pt-0.5">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      TITULO[estado],
                    )}
                  >
                    {etapa.titulo}
                  </p>
                  {etapa.descricao ? (
                    <p className="mt-0.5 text-xs text-soft">
                      {etapa.descricao}
                    </p>
                  ) : null}
                </div>
              </div>

              {!ultima ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-3 mt-3.5 h-0.5 min-w-6 flex-1 rounded-full transition-colors duration-200",
                    feitas.has(i) ? "bg-brand-500" : "bg-line",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
