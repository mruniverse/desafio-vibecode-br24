"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type ToastTipo = "sucesso" | "erro" | "info" | "alerta";

export interface ToastOpcoes {
  /** Texto curto abaixo da mensagem principal. */
  descricao?: string;
  /** Milissegundos ate fechar sozinho. 0 desliga o auto-dismiss. */
  duracao?: number;
}

export interface Toast extends ToastOpcoes {
  id: string;
  tipo: ToastTipo;
  mensagem: string;
}

/** Funcao de disparo: `sucesso("Salvo!", { descricao: "..." })`. */
export type DispararToast = (mensagem: string, opcoes?: ToastOpcoes) => string;

export interface ToastApi {
  sucesso: DispararToast;
  erro: DispararToast;
  info: DispararToast;
  alerta: DispararToast;
  /** Fecha um toast especifico (use o id devolvido no disparo). */
  fechar: (id: string) => void;
}

const DURACAO_PADRAO = 5000;
// Erro fica mais tempo: normalmente exige leitura e alguma acao do usuario.
const DURACAO_ERRO = 8000;

const ToastContext = React.createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Maximo de toasts simultaneos; os mais antigos saem primeiro. */
  limite?: number;
}

export function ToastProvider({ children, limite = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const sequencia = React.useRef(0);

  const fechar = React.useCallback((id: string) => {
    setToasts((atuais) => atuais.filter((t) => t.id !== id));
  }, []);

  const adicionar = React.useCallback(
    (tipo: ToastTipo, mensagem: string, opcoes?: ToastOpcoes): string => {
      sequencia.current += 1;
      const id = `toast-${sequencia.current}`;
      const novo: Toast = {
        id,
        tipo,
        mensagem,
        descricao: opcoes?.descricao,
        duracao:
          opcoes?.duracao ??
          (tipo === "erro" ? DURACAO_ERRO : DURACAO_PADRAO),
      };
      // Empilha e corta o excedente: pilha infinita cobriria a tela no mobile.
      setToasts((atuais) => [...atuais, novo].slice(-limite));
      return id;
    },
    [limite],
  );

  const api = React.useMemo<ToastApi>(
    () => ({
      sucesso: (mensagem, opcoes) => adicionar("sucesso", mensagem, opcoes),
      erro: (mensagem, opcoes) => adicionar("erro", mensagem, opcoes),
      info: (mensagem, opcoes) => adicionar("info", mensagem, opcoes),
      alerta: (mensagem, opcoes) => adicionar("alerta", mensagem, opcoes),
      fechar,
    }),
    [adicionar, fechar],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onFechar={fechar} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  }
  return ctx;
}

/* -------------------------------------------------------------------------- */

const TONS: Record<ToastTipo, string> = {
  sucesso: "border-l-success-500",
  erro: "border-l-danger-500",
  info: "border-l-brand-500",
  alerta: "border-l-warning-500",
};

const CORES_ICONE: Record<ToastTipo, string> = {
  sucesso: "text-success-700",
  erro: "text-danger-700",
  info: "text-brand-600",
  alerta: "text-warning-700",
};

const PREFIXO_LEITOR: Record<ToastTipo, string> = {
  sucesso: "Sucesso:",
  erro: "Erro:",
  info: "Aviso:",
  alerta: "Atenção:",
};

function IconeToast({ tipo }: { tipo: ToastTipo }) {
  const comum = {
    viewBox: "0 0 20 20",
    fill: "currentColor",
    "aria-hidden": true,
    className: cn("size-5 shrink-0", CORES_ICONE[tipo]),
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

interface ToastViewportProps {
  toasts: Toast[];
  onFechar: (id: string) => void;
}

function ToastViewport({ toasts, onFechar }: ToastViewportProps) {
  return (
    <div
      // pointer-events-none no container e auto em cada toast: a area vazia
      // nunca rouba clique do conteudo que esta atras.
      className={cn(
        "pointer-events-none fixed z-50 flex flex-col gap-2",
        // Mobile: topo, largura total — nao tapa os botoes de acao do rodape.
        "inset-x-0 top-0 p-3",
        // Desktop: canto inferior direito, fora do fluxo de leitura.
        "sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:w-[22rem] sm:p-0",
      )}
    >
      {toasts.map((toast) => (
        <ItemToast key={toast.id} toast={toast} onFechar={onFechar} />
      ))}
    </div>
  );
}

interface ItemToastProps {
  toast: Toast;
  onFechar: (id: string) => void;
}

function ItemToast({ toast, onFechar }: ItemToastProps) {
  const { id, tipo, mensagem, descricao, duracao = DURACAO_PADRAO } = toast;
  const [pausado, setPausado] = React.useState(false);

  React.useEffect(() => {
    // Pausa com mouse em cima ou foco dentro: ninguem perde a mensagem
    // enquanto le ou tenta clicar no botao de fechar.
    if (duracao <= 0 || pausado) return;
    const timer = window.setTimeout(() => onFechar(id), duracao);
    return () => window.clearTimeout(timer);
  }, [id, duracao, pausado, onFechar]);

  return (
    <div
      role={tipo === "erro" || tipo === "alerta" ? "alert" : "status"}
      aria-live={tipo === "erro" || tipo === "alerta" ? "assertive" : "polite"}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
      className={cn(
        // border-y/-r + border-l-4 em vez de `border` + `border-l-4`: evita
        // depender da ordem de precedencia entre shorthand e lado especifico.
        "br24-fade-up pointer-events-auto flex items-start gap-3 rounded-md border-y border-r border-l-4 border-line bg-card px-3.5 py-3 shadow-lg",
        TONS[tipo],
      )}
    >
      <IconeToast tipo={tipo} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-strong">
          <span className="sr-only">{PREFIXO_LEITOR[tipo]} </span>
          {mensagem}
        </p>
        {descricao ? (
          <p className="mt-0.5 text-sm text-soft">{descricao}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onFechar(id)}
        aria-label="Fechar notificação"
        className="-my-1 -mr-1 grid size-9 min-h-9 shrink-0 place-items-center rounded-sm text-soft transition-colors duration-150 hover:bg-muted hover:text-strong"
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
    </div>
  );
}
