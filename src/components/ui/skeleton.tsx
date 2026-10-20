import * as React from "react";

import { cn } from "@/lib/utils";

export interface SkeletonProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Aceita numero (px) ou string CSS (ex.: "60%"). */
  largura?: number | string;
  altura?: number | string;
  circular?: boolean;
}

/**
 * Placeholder de carregamento. Sempre aria-hidden: quem anuncia o estado e o
 * container, com aria-busy. Evita leitor de tela lendo blocos vazios.
 */
export function Skeleton({
  largura,
  altura,
  circular = false,
  className,
  style,
  ...resto
}: SkeletonProps) {
  return (
    <div
      {...resto}
      aria-hidden="true"
      style={{ width: largura, height: altura, ...style }}
      className={cn(
        "br24-skeleton",
        circular ? "rounded-full" : "rounded-sm",
        altura === undefined && "h-4",
        largura === undefined && !circular && "w-full",
        className,
      )}
    />
  );
}

export interface SkeletonTextProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  linhas?: number;
}

export function SkeletonText({
  linhas = 3,
  className,
  ...resto
}: SkeletonTextProps) {
  const total = Math.max(1, linhas);

  return (
    <div
      {...resto}
      aria-hidden="true"
      className={cn("flex flex-col gap-2", className)}
    >
      {Array.from({ length: total }, (_, i) => (
        <Skeleton
          key={i}
          // Ultima linha curta: imita paragrafo real e deixa o loading menos
          // "quadrado", o que reduz a sensacao de travamento.
          largura={i === total - 1 && total > 1 ? "62%" : undefined}
          altura="0.875rem"
        />
      ))}
    </div>
  );
}
