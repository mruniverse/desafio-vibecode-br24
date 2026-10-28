/**
 * Cliente HTTP das rotas /api/ausencias/*. Devolve sempre um resultado
 * normalizado (`{ok:true,dados}` ou `{ok:false,erro}`): a tela nunca precisa de
 * try/catch de rede. Nada de segredo aqui: a sessao e um cookie httpOnly.
 *
 * So importa TIPOS dos contratos (apagados no build do cliente).
 */
import type {
  EntradaCreditar,
  EntradaCriarPedido,
  EntradaDecidir,
  EntradaEtapa,
  EntradaMinimo,
  PreviaPedido,
} from "@/lib/ausencias/servicos";
import type { DataISO, Equipe, Etapa, Papel, Tipo } from "@/lib/ausencias/tipos";
import type {
  CalendarioVisao,
  DisponibilidadeVisao,
  ImpactoPedidoVisao,
  NotificacaoVisao,
  PainelVisao,
  PedidoVisao,
  PessoaVisao,
  SaldoVisao,
  SincronizacaoLogVisao,
} from "@/lib/ausencias/visoes";

export interface ErroApi {
  codigo: string;
  mensagem: string;
  /** 422: mensagem por campo, para destacar o input certo. */
  campos?: Record<string, string>;
  /** Dados de apoio não sensíveis (ex.: `recalculo`, a assinatura a reenviar para confirmar). */
  extras?: Record<string, string>;
}

export type Resp<T> = { ok: true; dados: T } | { ok: false; erro: ErroApi; status: number };

export interface PessoaDemo {
  id: string;
  nome: string;
  papel: Papel;
  equipeId: string;
  equipe: string;
  funcao?: string;
}

export interface ContextoDemo {
  modoDemo: boolean;
  selo: string | null;
  hoje: DataISO;
  atual: PessoaDemo | null;
  pessoas: PessoaDemo[];
}

const ERRO_REDE: ErroApi = {
  codigo: "FALHA_REDE",
  mensagem: "Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.",
};
const ERRO_FORMATO: ErroApi = {
  codigo: "RESPOSTA_INVALIDA",
  mensagem: "O servidor respondeu de um jeito inesperado. Tente de novo em instantes.",
};

type Metodo = "GET" | "POST" | "PUT" | "DELETE";

async function chamar<T>(metodo: Metodo, url: string, corpo?: unknown): Promise<Resp<T>> {
  try {
    const r = await fetch(url, {
      method: metodo,
      cache: "no-store",
      credentials: "same-origin",
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const json: unknown = await r.json().catch(() => null);
    if (typeof json === "object" && json !== null) {
      const c = json as { ok?: unknown; dados?: unknown; erro?: unknown };
      if (c.ok === true && "dados" in c) return { ok: true, dados: c.dados as T };
      if (c.ok === false && typeof c.erro === "object" && c.erro !== null) {
        return { ok: false, erro: c.erro as ErroApi, status: r.status };
      }
    }
    return { ok: false, erro: ERRO_FORMATO, status: r.status };
  } catch {
    return { ok: false, erro: ERRO_REDE, status: 0 };
  }
}

function q(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

const B = "/api/ausencias";

export const api = {
  contexto: () => chamar<ContextoDemo>("GET", `${B}/sessao-demo`),
  entrar: (pessoaId: string) => chamar<{ pessoa: PessoaDemo; selo: string }>("POST", `${B}/sessao-demo`, { pessoaId }),
  sair: () => chamar<{ saiu: boolean }>("DELETE", `${B}/sessao-demo`),

  eu: () => chamar<PessoaVisao>("GET", `${B}/eu`),
  tipos: () => chamar<Tipo[]>("GET", `${B}/tipos`),
  saldos: () => chamar<SaldoVisao[]>("GET", `${B}/saldos`),
  notificacoes: () => chamar<NotificacaoVisao[]>("GET", `${B}/notificacoes`),

  previa: (e: EntradaCriarPedido) => chamar<PreviaPedido>("POST", `${B}/previa`, e),
  meusPedidos: () => chamar<PedidoVisao[]>("GET", `${B}/pedidos`),
  paraAprovar: () => chamar<PedidoVisao[]>("GET", `${B}/pedidos/para-aprovar`),
  pedido: (id: number) => chamar<PedidoVisao>("GET", `${B}/pedidos/${id}`),
  criarPedido: (e: EntradaCriarPedido) => chamar<PedidoVisao>("POST", `${B}/pedidos`, e),
  decidir: (id: number, e: EntradaDecidir) => chamar<PedidoVisao>("POST", `${B}/pedidos/${id}/decisao`, e),
  cancelar: (id: number) => chamar<PedidoVisao>("POST", `${B}/pedidos/${id}/cancelar`, {}),
  impacto: (id: number) => chamar<ImpactoPedidoVisao>("GET", `${B}/pedidos/${id}/impacto`),
  lembrar: (id: number) => chamar<{ lembrado: boolean }>("POST", `${B}/pedidos/${id}/lembrar`, {}),

  creditar: (e: EntradaCreditar) => chamar<{ creditado: boolean }>("POST", `${B}/creditar`, e),
  calendario: (equipeId: string, de: DataISO, ate: DataISO) =>
    chamar<CalendarioVisao>("GET", `${B}/calendario${q({ equipeId, de, ate })}`),
  disponibilidade: (equipeId: string, de: DataISO, ate: DataISO) =>
    chamar<DisponibilidadeVisao>("GET", `${B}/disponibilidade${q({ equipeId, de, ate })}`),
  painel: (equipeId?: string) => chamar<PainelVisao>("GET", `${B}/painel${q({ equipeId })}`),

  etapas: () => chamar<Etapa[]>("GET", `${B}/etapas`),
  editarEtapa: (e: EntradaEtapa) => chamar<Etapa[]>("PUT", `${B}/etapas`, e),
  equipes: () => chamar<Equipe[]>("GET", `${B}/equipes`),
  definirMinimo: (equipeId: string, e: EntradaMinimo) =>
    chamar<Equipe>("PUT", `${B}/equipes/${encodeURIComponent(equipeId)}/minimo`, e),
  logSincronizacao: () => chamar<SincronizacaoLogVisao[]>("GET", `${B}/sincronizacao`),
  reprocessar: (pedidoId?: number) =>
    chamar<{ reprocessado: boolean }>("POST", `${B}/sincronizacao/reprocessar`, pedidoId === undefined ? {} : { pedidoId }),
};
