"use client";

/**
 * Abas acessíveis (padrão WAI-ARIA "Tabs"): role=tablist/tab/tabpanel,
 * setas ← → (e Home/End) movem o foco e ativam, só a aba ativa entra na ordem do Tab.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface AbaDef<Id extends string> {
  id: Id;
  rotulo: string;
}

export interface AbasProps<Id extends string> {
  /** Texto lido pelo leitor de tela para a lista de abas. */
  rotuloLista: string;
  abas: readonly AbaDef<Id>[];
  ativa: Id;
  onMudar: (id: Id) => void;
  /** Conteúdo de cada aba; só o da aba ativa é chamado. */
  children: (id: Id) => React.ReactNode;
  prefixoId?: string;
}

export function Abas<Id extends string>({
  rotuloLista,
  abas,
  ativa,
  onMudar,
  children,
  prefixoId = "abas",
}: AbasProps<Id>) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  function irPara(indice: number) {
    const alvo = abas[(indice + abas.length) % abas.length];
    if (!alvo) return;
    onMudar(alvo.id);
    refs.current[alvo.id]?.focus();
  }

  function aoTeclar(e: React.KeyboardEvent, indice: number) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      irPara(indice + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      irPara(indice - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      irPara(0);
    } else if (e.key === "End") {
      e.preventDefault();
      irPara(abas.length - 1);
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={rotuloLista}
        className="flex flex-wrap gap-x-1 border-b border-line"
      >
        {abas.map((aba, i) => {
          const selecionada = aba.id === ativa;
          return (
            <button
              key={aba.id}
              ref={(el) => {
                refs.current[aba.id] = el;
              }}
              type="button"
              role="tab"
              id={`${prefixoId}-aba-${aba.id}`}
              aria-selected={selecionada}
              aria-controls={`${prefixoId}-painel-${aba.id}`}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => onMudar(aba.id)}
              onKeyDown={(e) => aoTeclar(e, i)}
              className={cn(
                "-mb-px shrink-0 whitespace-nowrap rounded-b-none border-b-2 px-4 text-sm font-medium transition-colors duration-150",
                selecionada
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-soft hover:text-strong",
              )}
            >
              {aba.rotulo}
            </button>
          );
        })}
      </div>

      {abas.map((aba) => {
        const selecionada = aba.id === ativa;
        return (
          <div
            key={aba.id}
            role="tabpanel"
            id={`${prefixoId}-painel-${aba.id}`}
            aria-labelledby={`${prefixoId}-aba-${aba.id}`}
            hidden={!selecionada}
            tabIndex={0}
            className="pt-5"
          >
            {selecionada ? children(aba.id) : null}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças de formulário compartilhadas pelas abas do admin.                    */
/* -------------------------------------------------------------------------- */

const CLASSE_SELECT =
  "h-11 min-h-11 w-full rounded-md border bg-card px-3 text-base text-strong transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-muted disabled:text-soft sm:text-sm";

export interface SeletorProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  rotulo: string;
  ajuda?: string;
  erro?: string;
  obrigatorio?: boolean;
  classNameRaiz?: string;
}

/** <select> nativo (acessível em qualquer aparelho) com o mesmo visual dos campos do app. */
export function Seletor({
  rotulo,
  ajuda,
  erro,
  obrigatorio = false,
  classNameRaiz,
  className,
  id,
  children,
  ...resto
}: SeletorProps) {
  const gerado = React.useId();
  const idCampo = id ?? `sel-${gerado}`;
  const idMsg = `${idCampo}-msg`;
  return (
    <div className={cn("flex flex-col gap-1.5", classNameRaiz)}>
      <label htmlFor={idCampo} className="text-sm font-medium text-strong">
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
      <select
        {...resto}
        id={idCampo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro || ajuda ? idMsg : undefined}
        className={cn(
          CLASSE_SELECT,
          erro ? "border-danger-500" : "border-line hover:border-line-strong",
          className,
        )}
      >
        {children}
      </select>
      {erro ? (
        <p id={idMsg} aria-live="polite" className="text-sm font-medium text-danger-700">
          {erro}
        </p>
      ) : ajuda ? (
        <p id={idMsg} className="text-sm text-soft">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
}

/** Texto de "Em breve" para o que está no plano mas ainda não existe. */
export function EmBreve({ children = "Em breve" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-line bg-muted px-2 py-0.5 text-xs font-medium text-body">
      {children}
    </span>
  );
}
