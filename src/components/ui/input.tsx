"use client";

// 'use client' por causa do React.useId: ele gera o id que liga <label> ao
// campo quando quem usa nao passa um id proprio.

import * as React from "react";

import { cn } from "@/lib/utils";

export interface CampoBaseProps {
  rotulo?: string;
  /** Texto auxiliar, exibido abaixo do campo. Some quando ha erro. */
  ajuda?: string;
  /** Mensagem de erro: substitui o texto de ajuda e marca o campo. */
  erro?: string;
  /** Mostra asterisco e aplica required. */
  obrigatorio?: boolean;
  /** Classe do contorno (label + campo + mensagem). */
  classNameRaiz?: string;
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    CampoBaseProps {}

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    CampoBaseProps {}

// text-base no mobile e proposital: fonte menor que 16px faz o iOS dar zoom
// no campo ao focar, o que desloca o app dentro do iframe do Bitrix24.
const BASE_CAMPO =
  "w-full rounded-md border bg-card px-3 text-base text-strong transition-colors duration-150 placeholder:text-soft disabled:cursor-not-allowed disabled:bg-muted disabled:text-soft sm:text-sm";

function classesCampo(temErro: boolean): string {
  return cn(
    BASE_CAMPO,
    temErro ? "border-danger-500" : "border-line hover:border-line-strong",
  );
}

interface EnvoltorioProps extends CampoBaseProps {
  idCampo: string;
  idAjuda: string;
  idErro: string;
  children: React.ReactNode;
}

function EnvoltorioCampo({
  idCampo,
  idAjuda,
  idErro,
  rotulo,
  ajuda,
  erro,
  obrigatorio,
  classNameRaiz,
  children,
}: EnvoltorioProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", classNameRaiz)}>
      {rotulo ? (
        <label
          htmlFor={idCampo}
          className="text-sm font-medium text-strong"
        >
          {rotulo}
          {obrigatorio ? (
            <>
              <span aria-hidden="true" className="ml-0.5 text-danger-500">
                *
              </span>
              <span className="sr-only"> (obrigatório)</span>
            </>
          ) : null}
        </label>
      ) : null}

      {children}

      {erro ? (
        <p
          id={idErro}
          aria-live="polite"
          className="text-sm font-medium text-danger-700"
        >
          {erro}
        </p>
      ) : ajuda ? (
        <p id={idAjuda} className="text-sm text-soft">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
}

/** Monta o aria-describedby sem perder o que veio por prop. */
function descricaoAcessivel(
  temErro: boolean,
  temAjuda: boolean,
  idAjuda: string,
  idErro: string,
  extra?: string,
): string | undefined {
  const ids = [
    temErro ? idErro : null,
    !temErro && temAjuda ? idAjuda : null,
    extra,
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      rotulo,
      ajuda,
      erro,
      obrigatorio = false,
      classNameRaiz,
      className,
      id,
      "aria-describedby": descritoPor,
      ...resto
    },
    ref,
  ) {
    const gerado = React.useId();
    const idCampo = id ?? `campo-${gerado}`;
    const temErro = Boolean(erro);

    return (
      <EnvoltorioCampo
        idCampo={idCampo}
        idAjuda={`${idCampo}-ajuda`}
        idErro={`${idCampo}-erro`}
        rotulo={rotulo}
        ajuda={ajuda}
        erro={erro}
        obrigatorio={obrigatorio}
        classNameRaiz={classNameRaiz}
      >
        <input
          {...resto}
          ref={ref}
          id={idCampo}
          required={obrigatorio || resto.required}
          aria-invalid={temErro || undefined}
          aria-describedby={descricaoAcessivel(
            temErro,
            Boolean(ajuda),
            `${idCampo}-ajuda`,
            `${idCampo}-erro`,
            descritoPor,
          )}
          className={cn(classesCampo(temErro), "h-11 min-h-11", className)}
        />
      </EnvoltorioCampo>
    );
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      rotulo,
      ajuda,
      erro,
      obrigatorio = false,
      classNameRaiz,
      className,
      id,
      rows = 4,
      "aria-describedby": descritoPor,
      ...resto
    },
    ref,
  ) {
    const gerado = React.useId();
    const idCampo = id ?? `campo-${gerado}`;
    const temErro = Boolean(erro);

    return (
      <EnvoltorioCampo
        idCampo={idCampo}
        idAjuda={`${idCampo}-ajuda`}
        idErro={`${idCampo}-erro`}
        rotulo={rotulo}
        ajuda={ajuda}
        erro={erro}
        obrigatorio={obrigatorio}
        classNameRaiz={classNameRaiz}
      >
        <textarea
          {...resto}
          ref={ref}
          id={idCampo}
          rows={rows}
          required={obrigatorio || resto.required}
          aria-invalid={temErro || undefined}
          aria-describedby={descricaoAcessivel(
            temErro,
            Boolean(ajuda),
            `${idCampo}-ajuda`,
            `${idCampo}-erro`,
            descritoPor,
          )}
          className={cn(
            classesCampo(temErro),
            "min-h-28 resize-y py-2.5",
            className,
          )}
        />
      </EnvoltorioCampo>
    );
  },
);
