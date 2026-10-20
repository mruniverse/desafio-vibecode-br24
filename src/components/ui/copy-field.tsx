"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface CopyFieldProps {
  valor: string;
  rotulo?: string;
  ajuda?: string;
  /** Fonte monoespacada: melhor para URLs e chaves. Padrao: true. */
  mono?: boolean;
  className?: string;
}

/**
 * Campo somente-leitura com botao de copiar. Usado no wizard para o cliente
 * levar a URL de redirect do OAuth ate o painel do Bitrix24.
 *
 * Dentro de iframe o navegador pode bloquear a Clipboard API; nesse caso
 * selecionamos o texto e pedimos Ctrl+C, em vez de falhar em silencio.
 */
export function CopyField({
  valor,
  rotulo,
  ajuda,
  mono = true,
  className,
}: CopyFieldProps) {
  const idCampo = React.useId();
  const refInput = React.useRef<HTMLInputElement>(null);
  const [estado, setEstado] = React.useState<"parado" | "copiado" | "manual">(
    "parado",
  );

  // Volta ao estado normal depois de 2s, sem deixar timer solto ao desmontar.
  React.useEffect(() => {
    if (estado === "parado") return;
    const timer = window.setTimeout(() => setEstado("parado"), 2000);
    return () => window.clearTimeout(timer);
  }, [estado]);

  function selecionarTudo() {
    const campo = refInput.current;
    if (!campo) return;
    campo.focus();
    campo.select();
    campo.setSelectionRange(0, valor.length);
  }

  async function copiar() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(valor);
      setEstado("copiado");
    } catch {
      // Sem permissao de clipboard: o texto fica selecionado e a dica muda.
      selecionarTudo();
      setEstado("manual");
    }
  }

  const textoBotao =
    estado === "copiado"
      ? "Copiado!"
      : estado === "manual"
        ? "Use Ctrl+C"
        : "Copiar";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {rotulo ? (
        <label htmlFor={idCampo} className="text-sm font-medium text-strong">
          {rotulo}
        </label>
      ) : null}

      <div className="flex items-stretch gap-2">
        <input
          ref={refInput}
          id={idCampo}
          type="text"
          value={valor}
          readOnly
          onFocus={selecionarTudo}
          aria-describedby={`${idCampo}-dica`}
          className={cn(
            "h-11 min-w-0 flex-1 truncate rounded-md border border-line bg-muted px-3 text-sm text-body",
            mono && "font-mono",
          )}
        />
        <button
          type="button"
          onClick={copiar}
          className={cn(
            "inline-flex h-11 min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-150",
            estado === "copiado"
              ? "border-success-500 bg-success-50 text-success-700"
              : "border-line-strong bg-card text-strong hover:bg-muted",
          )}
        >
          {estado === "copiado" ? (
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
          ) : (
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="size-4"
            >
              <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h5A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 7 12.5v-9Z" />
              <path d="M5 5.5A1.5 1.5 0 0 0 3.5 7v9A1.5 1.5 0 0 0 5 17.5h5A1.5 1.5 0 0 0 11.5 16v-.5h-3A2.5 2.5 0 0 1 6 13V5.5H5Z" />
            </svg>
          )}
          {textoBotao}
        </button>
      </div>

      {/* aria-live anuncia a confirmacao: sem isso, quem usa leitor de tela
          nao sabe se a copia funcionou. */}
      <p id={`${idCampo}-dica`} aria-live="polite" className="text-sm text-soft">
        {estado === "copiado"
          ? "Valor copiado para a área de transferência."
          : estado === "manual"
            ? "Texto selecionado. Pressione Ctrl+C (ou Cmd+C) para copiar."
            : ajuda}
      </p>
    </div>
  );
}
