"use client";

import * as React from "react";
import type { DataISO } from "@/lib/ausencias/tipos";
import { api, type ContextoDemo, type ErroApi, type PessoaDemo } from "./api";

export interface ValorContexto {
  /** Data "de hoje" da demonstração (fixa; a demo não envelhece). */
  hoje: DataISO;
  /** Quem está logado na demonstração. Sempre definido dentro das telas. */
  atual: PessoaDemo;
  pessoas: PessoaDemo[];
  selo: string;
  trocarPara: (pessoaId: string) => Promise<ErroApi | null>;
  sair: () => Promise<void>;
}

const Contexto = React.createContext<ValorContexto | null>(null);

export const ProvedorAusencias = Contexto.Provider;

/** Contexto da sessão-demo. Só funciona dentro do <ShellAusencias>. */
export function useAusencias(): ValorContexto {
  const v = React.useContext(Contexto);
  if (!v) throw new Error("useAusencias precisa estar dentro de <ShellAusencias>.");
  return v;
}

export type { ContextoDemo };
export { api };
