"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui";
import { Abas, type AbaDef } from "./abas";
import { useAusencias } from "./contexto";
import { Carregando } from "./estados";
import { ConfiguracoesAdmin } from "./configuracoes-admin";
import { EtapasAdmin } from "./etapas-admin";
import { PainelAdmin } from "./painel-admin";

type IdAba = "painel" | "etapas" | "configuracoes";

const ABAS: readonly AbaDef<IdAba>[] = [
  { id: "painel", rotulo: "Painel" },
  { id: "etapas", rotulo: "Etapas do pedido" },
  { id: "configuracoes", rotulo: "Configurações" },
];

function abaDaUrl(valor: string | null): IdAba {
  return ABAS.find((a) => a.id === valor)?.id ?? "painel";
}

function ConteudoAdmin() {
  const { atual } = useAusencias();
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const ativa = abaDaUrl(params.get("aba"));

  const mudar = React.useCallback(
    (id: IdAba) => {
      const novos = new URLSearchParams(params.toString());
      novos.set("aba", id);
      router.replace(`${caminho}?${novos.toString()}`, { scroll: false });
    },
    [params, router, caminho],
  );

  if (atual.papel !== "admin") {
    return (
      <Alert tipo="info" titulo="Esta área é só para administradores">
        Para ver o painel e as configurações, entre como administrador no seletor “Ver demonstração como”.
      </Alert>
    );
  }

  return (
    <Abas rotuloLista="Seções do painel e das configurações" abas={ABAS} ativa={ativa} onMudar={mudar} prefixoId="admin">
      {(id) => (id === "painel" ? <PainelAdmin /> : id === "etapas" ? <EtapasAdmin /> : <ConfiguracoesAdmin />)}
    </Abas>
  );
}

export function TelaAdmin() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-strong">Painel e configurações</h1>
        <p className="mt-1 text-sm text-soft">Acompanhe os pedidos da empresa e ajuste como o Revezza funciona.</p>
      </div>
      <React.Suspense fallback={<Carregando />}>
        <ConteudoAdmin />
      </React.Suspense>
    </div>
  );
}
