"use client";

import * as React from "react";
import type { ErroApi, Resp } from "./api";

export type EstadoCarga<T> =
  | { status: "carregando" }
  | { status: "erro"; erro: ErroApi }
  | { status: "pronto"; dados: T };

/**
 * Busca dados e expõe os estados da tela (carregando, erro, pronto).
 * `buscar` precisa ser estável (useCallback): quando muda, recarrega.
 * `recarregar()` refaz a busca sem piscar o conteúdo antigo; `limpar` volta ao carregando.
 */
export function useCarregar<T>(buscar: () => Promise<Resp<T>>) {
  const [estado, setEstado] = React.useState<EstadoCarga<T>>({ status: "carregando" });
  const [tentativa, setTentativa] = React.useState(0);

  React.useEffect(() => {
    let vivo = true;
    buscar().then((r) => {
      if (!vivo) return;
      setEstado(r.ok ? { status: "pronto", dados: r.dados } : { status: "erro", erro: r.erro });
    });
    return () => {
      vivo = false;
    };
  }, [buscar, tentativa]);

  const recarregar = React.useCallback(() => setTentativa((n) => n + 1), []);
  const tentarDeNovo = React.useCallback(() => {
    setEstado({ status: "carregando" });
    setTentativa((n) => n + 1);
  }, []);

  return { estado, recarregar, tentarDeNovo };
}
