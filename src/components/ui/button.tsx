import * as React from "react";

import { cn } from "@/lib/utils";

import { Spinner } from "./spinner";

export type ButtonVariante = "primary" | "secondary" | "ghost" | "danger";
export type ButtonTamanho = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: ButtonVariante;
  tamanho?: ButtonTamanho;
  /** Mostra spinner no lugar do icone da esquerda e bloqueia novos cliques. */
  loading?: boolean;
  iconeEsquerda?: React.ReactNode;
  iconeDireita?: React.ReactNode;
  /** Largura total: usado no mobile, onde o botao principal ocupa a linha. */
  full?: boolean;
}

const VARIANTES: Record<ButtonVariante, string> = {
  primary:
    "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-700",
  secondary:
    "border border-line-strong bg-card text-strong shadow-sm hover:bg-muted active:bg-muted",
  ghost: "bg-transparent text-body hover:bg-muted hover:text-strong",
  danger:
    "bg-danger-500 text-white shadow-sm hover:bg-danger-700 active:bg-danger-700",
};

const TAMANHOS: Record<ButtonTamanho, string> = {
  // `min-h-*` acompanha o `h-*` porque o CSS global forca 2.75rem em button:
  // sem isso o tamanho "sm" nunca ficaria compacto.
  sm: "h-10 min-h-10 gap-1.5 rounded-sm px-3 text-sm",
  md: "h-11 min-h-11 gap-2 rounded-md px-4 text-sm",
  lg: "h-12 min-h-12 gap-2 rounded-md px-5 text-base",
};

const BASE =
  "inline-flex select-none items-center justify-center font-medium transition-[background-color,color,box-shadow,opacity] duration-150";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variante = "primary",
      tamanho = "md",
      loading = false,
      iconeEsquerda,
      iconeDireita,
      full = false,
      className,
      children,
      disabled = false,
      // Padrao "button" de proposito: evita submit acidental de formulario,
      // o erro mais comum quando o botao vive dentro de um <form>.
      type = "button",
      ...resto
    },
    ref,
  ) {
    const bloqueado = disabled || loading;

    return (
      <button
        {...resto}
        ref={ref}
        type={type}
        disabled={bloqueado}
        aria-busy={loading || undefined}
        className={cn(
          BASE,
          VARIANTES[variante],
          TAMANHOS[tamanho],
          full && "w-full",
          // Carregando segue colorido (acao em andamento); desabilitado
          // apaga de verdade (acao indisponivel). Estados bem distintos.
          loading && "cursor-progress",
          disabled && !loading && "cursor-not-allowed opacity-60 shadow-none",
          className,
        )}
      >
        {loading ? (
          <Spinner tamanho="sm" decorativo />
        ) : iconeEsquerda ? (
          <span className="shrink-0" aria-hidden="true">
            {iconeEsquerda}
          </span>
        ) : null}

        {children ? <span className="truncate">{children}</span> : null}

        {!loading && iconeDireita ? (
          <span className="shrink-0" aria-hidden="true">
            {iconeDireita}
          </span>
        ) : null}
      </button>
    );
  },
);
