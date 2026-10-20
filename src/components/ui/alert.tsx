import * as React from "react";

import { cn } from "@/lib/utils";

export type AlertTipo = "info" | "sucesso" | "alerta" | "erro";

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tipo?: AlertTipo;
  titulo?: React.ReactNode;
  /** Botao ou link de acao, abaixo do texto. */
  acao?: React.ReactNode;
  /** Quando informado, mostra o botao de fechar. */
  onFechar?: () => void;
  rotuloFechar?: string;
}

const TONS: Record<AlertTipo, string> = {
  info: "border-brand-200 bg-brand-50 text-brand-700",
  sucesso: "border-success-500 bg-success-50 text-success-700",
  alerta: "border-warning-500 bg-warning-50 text-warning-700",
  erro: "border-danger-500 bg-danger-50 text-danger-700",
};

function IconeAlerta({ tipo }: { tipo: AlertTipo }) {
  const comum = {
    viewBox: "0 0 20 20",
    fill: "currentColor",
    "aria-hidden": true,
    className: "size-5 shrink-0",
  } as const;

  if (tipo === "sucesso") {
    return (
      <svg {...comum}>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (tipo === "erro") {
    return (
      <svg {...comum}>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (tipo === "alerta") {
    return (
      <svg {...comum}>
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.19-1.458-1.516-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <svg {...comum}>
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Alert({
  tipo = "info",
  titulo,
  acao,
  onFechar,
  rotuloFechar = "Fechar aviso",
  className,
  children,
  ...resto
}: AlertProps) {
  // Erro e alerta interrompem a leitura (role=alert); sucesso e info entram
  // de forma educada (role=status), sem cortar o que o leitor esta falando.
  const papel = tipo === "erro" || tipo === "alerta" ? "alert" : "status";

  return (
    <div
      {...resto}
      role={papel}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3",
        TONS[tipo],
        className,
      )}
    >
      <IconeAlerta tipo={tipo} />

      <div className="min-w-0 flex-1">
        {titulo ? (
          <p className="text-sm font-semibold">{titulo}</p>
        ) : null}
        {children ? (
          <div
            className={cn("text-sm text-body", Boolean(titulo) && "mt-0.5")}
          >
            {children}
          </div>
        ) : null}
        {acao ? <div className="mt-2.5">{acao}</div> : null}
      </div>

      {onFechar ? (
        <button
          type="button"
          onClick={onFechar}
          aria-label={rotuloFechar}
          // min-h vem do CSS global; p-1 + size-4 garante alvo clicavel sem
          // empurrar o texto do aviso.
          className="-my-1 -mr-1 grid size-9 min-h-9 shrink-0 place-items-center rounded-sm text-current opacity-70 transition-opacity duration-150 hover:opacity-100"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className="size-4"
          >
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
