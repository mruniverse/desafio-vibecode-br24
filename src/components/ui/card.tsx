import * as React from "react";

import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Aplica a animacao de entrada do design system. */
  animado?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { animado = false, className, children, ...resto },
  ref,
) {
  return (
    <div
      {...resto}
      ref={ref}
      className={cn(
        // overflow-hidden garante que header/footer respeitem o raio do card.
        "overflow-hidden rounded-lg border border-line bg-card shadow-sm",
        animado && "br24-fade-up",
        className,
      )}
    >
      {children}
    </div>
  );
});

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  titulo?: React.ReactNode;
  descricao?: React.ReactNode;
  /** Botao ou link alinhado a direita do titulo. */
  acao?: React.ReactNode;
  /** Nivel do heading, para manter a hierarquia correta na pagina. */
  nivel?: "h2" | "h3" | "h4";
}

export function CardHeader({
  titulo,
  descricao,
  acao,
  nivel = "h3",
  className,
  children,
  ...resto
}: CardHeaderProps) {
  const Titulo = nivel;

  return (
    <div
      {...resto}
      className={cn(
        "flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0">
        {titulo ? (
          <Titulo className="truncate text-base font-semibold text-strong">
            {titulo}
          </Titulo>
        ) : null}
        {descricao ? (
          <p className="mt-1 text-sm text-soft">{descricao}</p>
        ) : null}
        {children}
      </div>
      {acao ? <div className="shrink-0">{acao}</div> : null}
    </div>
  );
}

export type CardBodyProps = React.HTMLAttributes<HTMLDivElement>;

export function CardBody({ className, children, ...resto }: CardBodyProps) {
  return (
    <div {...resto} className={cn("px-4 py-4 sm:px-5", className)}>
      {children}
    </div>
  );
}

export type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;

export function CardFooter({ className, children, ...resto }: CardFooterProps) {
  return (
    <div
      {...resto}
      className={cn(
        // No mobile os botoes empilham invertidos: a acao principal (ultima
        // no DOM) aparece no topo, onde o dedo alcanca primeiro.
        "flex flex-col-reverse gap-2 border-t border-line bg-card px-4 py-3.5 sm:flex-row sm:items-center sm:justify-end sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
