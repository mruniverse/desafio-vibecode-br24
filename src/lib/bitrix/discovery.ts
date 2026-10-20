/**
 * Descoberta de metadados do portal em tempo de execucao.
 *
 * Esta e a camada que garante o requisito "sem IDs fixos de usuarios, campos,
 * funis ou portais": nada aqui e constante. Cada funcao pergunta ao portal
 * quais sao os seus funis, etapas e campos, e tudo passa pelo cache local com
 * TTL de metadados.
 */
import { callRest, listAll } from "./client";
import { comCache, TTL, type ResultadoCache } from "@/lib/db/cache";

export interface UsuarioAtual {
  id: string;
  nome: string;
  email: string | null;
  admin: boolean;
  fotoUrl: string | null;
}

export interface Funil {
  id: string;
  nome: string;
  entityTypeId: number;
}

export interface Etapa {
  id: string;
  nome: string;
  ordem: number;
  cor: string | null;
  semantica: "processo" | "ganho" | "perda" | null;
}

export interface CampoCrm {
  nome: string;
  titulo: string;
  tipo: string;
  obrigatorio: boolean;
  multiplo: boolean;
  /** Opcoes de lista, quando o campo for enumeracao. */
  opcoes: { id: string; valor: string }[];
}

/** Quem esta usando o app agora (base para respeitar permissoes). */
export async function usuarioAtual(
  memberId: string,
): Promise<ResultadoCache<UsuarioAtual>> {
  return comCache(memberId, "profile:atual", TTL.cadastros, async () => {
    const r = await callRest<Record<string, unknown>>(memberId, "profile");
    const p = r.result ?? {};
    return {
      id: String(p.ID ?? ""),
      nome: [p.NAME, p.LAST_NAME].filter(Boolean).join(" ").trim() || "Usuario",
      email: (p.EMAIL as string) ?? null,
      admin: Boolean(p.ADMIN),
      fotoUrl: (p.PERSONAL_PHOTO as string) ?? null,
    };
  });
}

/** Escopos efetivamente concedidos ao app neste portal. */
export async function escoposConcedidos(
  memberId: string,
): Promise<ResultadoCache<string[]>> {
  return comCache(memberId, "scope:lista", TTL.metadados, async () => {
    const r = await callRest<string[]>(memberId, "scope");
    return r.result ?? [];
  });
}

/** Funis de negocio do portal — descobertos, nunca fixos. */
export async function funisDeNegocio(
  memberId: string,
): Promise<ResultadoCache<Funil[]>> {
  return comCache(memberId, "crm:funis", TTL.metadados, async () => {
    const r = await listAll<Record<string, unknown>>(
      memberId,
      "crm.category.list",
      { entityTypeId: 2 },
    );
    const funis: Funil[] = r.itens.map((c) => ({
      id: String(c.id ?? c.ID ?? ""),
      nome: String(c.name ?? c.NAME ?? "Funil"),
      entityTypeId: 2,
    }));
    // Portais antigos podem nao expor crm.category.list: cai no funil padrao.
    if (funis.length === 0) {
      return [{ id: "0", nome: "Funil padrao", entityTypeId: 2 }];
    }
    return funis;
  });
}

/** Etapas de um funil, com semantica (ganho/perda) resolvida pelo portal. */
export async function etapasDoFunil(
  memberId: string,
  funilId: string,
): Promise<ResultadoCache<Etapa[]>> {
  return comCache(memberId, `crm:etapas:${funilId}`, TTL.metadados, async () => {
    const entityId = funilId === "0" ? "DEAL_STAGE" : `DEAL_STAGE_${funilId}`;
    const r = await listAll<Record<string, unknown>>(memberId, "crm.status.list", {
      filter: { ENTITY_ID: entityId },
      order: { SORT: "ASC" },
    });
    return r.itens.map((s, indice) => ({
      id: String(s.STATUS_ID ?? ""),
      nome: String(s.NAME ?? ""),
      ordem: Number(s.SORT ?? indice),
      cor: ((s.COLOR as string) ?? null) || null,
      semantica: semanticaDaEtapa(String(s.STATUS_ID ?? "")),
    }));
  });
}

function semanticaDaEtapa(statusId: string): Etapa["semantica"] {
  if (/WON/i.test(statusId)) return "ganho";
  if (/LOSE|LOSS|APOLOGY/i.test(statusId)) return "perda";
  if (!statusId) return null;
  return "processo";
}

/**
 * Campos de uma entidade de CRM, incluindo os personalizados (UF_CRM_*).
 * `entidade`: "deal" | "lead" | "contact" | "company".
 */
export async function camposDaEntidade(
  memberId: string,
  entidade: "deal" | "lead" | "contact" | "company",
): Promise<ResultadoCache<CampoCrm[]>> {
  return comCache(memberId, `crm:campos:${entidade}`, TTL.metadados, async () => {
    const r = await callRest<Record<string, Record<string, unknown>>>(
      memberId,
      `crm.${entidade}.fields`,
    );
    const bruto = r.result ?? {};
    return Object.entries(bruto).map(([nome, def]) => ({
      nome,
      titulo: String(def.title ?? def.formLabel ?? nome),
      tipo: String(def.type ?? "string"),
      obrigatorio: Boolean(def.isRequired),
      multiplo: Boolean(def.isMultiple),
      opcoes: Array.isArray(def.items)
        ? (def.items as Record<string, unknown>[]).map((i) => ({
            id: String(i.ID ?? i.id ?? ""),
            valor: String(i.VALUE ?? i.value ?? ""),
          }))
        : [],
    }));
  });
}

/** Usuarios ativos do portal (para seletores de responsavel). */
export async function usuariosAtivos(
  memberId: string,
): Promise<ResultadoCache<{ id: string; nome: string }[]>> {
  return comCache(memberId, "user:ativos", TTL.cadastros, async () => {
    const r = await listAll<Record<string, unknown>>(memberId, "user.get", {
      FILTER: { ACTIVE: true },
    });
    return r.itens.map((u) => ({
      id: String(u.ID ?? ""),
      nome:
        [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim() ||
        String(u.EMAIL ?? "Usuario"),
    }));
  });
}
