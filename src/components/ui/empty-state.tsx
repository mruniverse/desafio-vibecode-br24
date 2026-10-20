import * as React from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icone?: React.ReactNode;
  titulo: string;
  descricao?: React.ReactNode;
  /** Sempre ofereca a saida: o proximo passo que resolve o vazio. */
  acao?: React.ReactNode;
}

function IconePadrao() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-7"
    >
      <path d="M3.75 7.5 12 3.75l8.25 3.75-8.25 3.75L3.75 7.5Z" />
      <path d="M20.25 7.5v9L12 20.25 3.75 16.5v-9" />
      <path d="M12 11.25v9" />
    </svg>
  );
}

/**
 * Primeira tela que o cliente ve antes de ter dados. Tom acolhedor e muito
 * espaco em branco: vazio aqui e etapa normal do onboarding, nao erro.
 */
export function EmptyState({
  icone,
  titulo,
  descricao,
  acao,
  className,
  children,
  ...resto
}: EmptyStateProps) {
  return (
    <div
      {...resto}
      className={cn(
        "br24-fade-up flex flex-col items-center justify-center px-6 py-14 text-center",
        className,
      )}
    >
      <div className="grid size-14 place-items-center rounded-full bg-brand-50 text-brand-600">
        {icone ?? <IconePadrao />}
      </div>

      <h3 className="mt-4 text-base font-semibold text-strong">{titulo}</h3>

      {descricao ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-soft">
          {descricao}
        </p>
      ) : null}

      {children}

      {acao ? <div className="mt-5">{acao}</div> : null}
    </div>
  );
}
