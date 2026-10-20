import * as React from "react";

import { cn } from "@/lib/utils";

export interface FieldGroupProps
  extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "title"> {
  titulo: string;
  descricao?: React.ReactNode;
}

/**
 * Agrupa campos relacionados em <fieldset>/<legend>: o leitor de tela anuncia
 * o titulo do grupo junto de cada campo, dando contexto sem repetir rotulo.
 */
export function FieldGroup({
  titulo,
  descricao,
  className,
  children,
  ...resto
}: FieldGroupProps) {
  return (
    <fieldset {...resto} className={cn("min-w-0 border-0 p-0", className)}>
      <legend className="text-sm font-semibold text-strong">{titulo}</legend>
      {descricao ? (
        <p className="mt-1 text-sm text-soft">{descricao}</p>
      ) : null}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </fieldset>
  );
}
