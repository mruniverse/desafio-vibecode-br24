import { escolherPorta } from "@/lib/bitrix/ausencias";
import { criarRelogio, modoDemo, portalDeAusencias, prepararDemo } from "@/lib/ausencias/boot";
import { listarEquipes, listarPessoas, papelNoBanco } from "@/lib/ausencias/repo";
import { criarServicosAusencias } from "@/lib/ausencias/servicos-impl";
import type { ServicosAusenciasImpl } from "@/lib/ausencias/servicos-impl";
import type { DataISO, Papel } from "@/lib/ausencias/tipos";

export interface ApoioDemo {
  hoje(): DataISO;
  pessoasDemo(): { id: string; nome: string; papel: Papel; equipeId: string; equipe: string; funcao?: string }[];
  papelDe(pessoaId: string): Papel | null;
}

let instancia: ServicosAusenciasImpl | undefined;
let tenant: string | undefined;
export function obterServicos(): ServicosAusenciasImpl {
  prepararDemo();
  const portal = portalDeAusencias();
  if (!instancia || tenant !== portal) {
    tenant = portal;
    instancia = criarServicosAusencias({ portalMemberId: portal, relogio: criarRelogio(), porta: escolherPorta() });
  }
  return instancia;
}

/** Descarta somente o cache do processo; dados SQLite permanecem intactos. */
export function reiniciarDemo(): void {
  instancia = undefined;
  tenant = undefined;
}

export function obterApoioDemo(): ApoioDemo {
  return {
    hoje: () => criarRelogio().hoje(),
    pessoasDemo: () => {
      if (!modoDemo()) return [];
      prepararDemo();
      const m = portalDeAusencias();
      const equipes = listarEquipes(m);
      return listarPessoas(m).map((p) => ({ id: p.id, nome: p.nome, papel: p.papel, equipeId: p.equipeId, funcao: p.funcao, equipe: equipes.find((e) => e.id === p.equipeId)?.nome ?? p.equipeId }));
    },
    papelDe: (id) => {
      if (!modoDemo()) return null;
      prepararDemo();
      return papelNoBanco(portalDeAusencias(), id);
    },
  };
}
