import * as React from "react";

import { cn } from "@/lib/utils";

export type BadgeTom = "neutro" | "marca" | "sucesso" | "alerta" | "perigo";
export type BadgeTamanho = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tom?: BadgeTom;
  tamanho?: BadgeTamanho;
  /** Bolinha colorida a esquerda: reforca o status sem depender so da cor. */
  pontinho?: boolean;
}

const TONS: Record<BadgeTom, string> = {
  neutro: "border border-line bg-muted text-body",
  marca: "border border-brand-200 bg-brand-50 text-brand-700",
  sucesso: "bg-success-50 text-success-700",
  alerta: "bg-warning-50 text-warning-700",
  perigo: "bg-danger-50 text-danger-700",
};

const PONTOS: Record<BadgeTom, string> = {
  neutro: "bg-soft",
  marca: "bg-brand-500",
  sucesso: "bg-success-500",
  alerta: "bg-warning-500",
  perigo: "bg-danger-500",
};

const TAMANHOS: Record<BadgeTamanho, string> = {
  sm: "gap-1 px-2 py-0.5 text-xs",
  md: "gap-1.5 px-2.5 py-1 text-sm",
};

export function Badge({
  tom = "neutro",
  tamanho = "sm",
  pontinho = false,
  className,
  children,
  ...resto
}: BadgeProps) {
  return (
    <span
      {...resto}
      className={cn(
        "inline-flex max-w-full items-center rounded-sm font-medium whitespace-nowrap",
        TONS[tom],
        TAMANHOS[tamanho],
        className,
      )}
    >
      {pontinho ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", PONTOS[tom])}
        />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
