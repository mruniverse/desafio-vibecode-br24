import * as React from "react";

import { cn } from "@/lib/utils";

export type SpinnerTamanho = "sm" | "md" | "lg";

export interface SpinnerProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  tamanho?: SpinnerTamanho;
  /** Texto lido por leitores de tela. Ignorado quando `decorativo`. */
  rotulo?: string;
  /**
   * Use quando o spinner ja esta dentro de um elemento que anuncia o estado
   * (ex.: botao com aria-busy). Evita o leitor de tela falar duas vezes.
   */
  decorativo?: boolean;
}

const TAMANHOS: Record<SpinnerTamanho, string> = {
  sm: "size-4 border-2",
  md: "size-6 border-2",
  lg: "size-9 border-[3px]",
};

/**
 * Spinner de borda em vez de SVG: herda `currentColor`, entao fica legivel
 * dentro de qualquer variante de botao sem precisar de cor extra.
 */
export function Spinner({
  tamanho = "md",
  rotulo = "Carregando",
  decorativo = false,
  className,
  ...resto
}: SpinnerProps) {
  return (
    <span
      {...resto}
      role={decorativo ? undefined : "status"}
      aria-label={decorativo ? undefined : rotulo}
      aria-hidden={decorativo ? true : undefined}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent align-[-0.125em]",
        TAMANHOS[tamanho],
        className,
      )}
    />
  );
}
