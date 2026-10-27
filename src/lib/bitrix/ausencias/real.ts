/**
 * BitrixReal: adaptador REAL de PortaBitrix sobre o cliente REST existente.
 *
 * Seguranca:
 *  - ESCRITA (criar/remover evento, notificar) so com `BITRIX_ESCRITA=1`
 *    (e, se informado, `portalDeTeste()` verdadeiro). Sem isso lanca
 *    ErroPortaBitrix `ESCRITA_BLOQUEADA` ANTES de qualquer chamada de rede.
 *  - O evento leva `name='Ausente'` e `description` so com `[BR24:<pedidoId>]`.
 *    Tipo, justificativa e motivo nunca chegam a esta camada.
 *  - Mensagens de erro passam por `sanitizarMensagem` (sem URL de webhook).
 *
 * Testabilidade: a chamada REST e injetada (`chamar`). O default carrega
 * `client.ts` e `portals.ts` por import dinamico, entao importar este modulo
 * nao abre banco nem exige variaveis de ambiente.
 *
 * A VALIDAR NUM PORTAL DE TESTE (sem spike ainda): offset de fuso do evento,
 * formato exato de `calendar.event.get`, codigo de erro do delete inexistente.
 */
import { NOME_EVENTO_BITRIX } from "../../ausencias/tipos";
import type { CalendarioTrabalho, DataISO } from "../../ausencias/tipos";
import type { EventoCalendarioBitrix, PortaBitrix } from "../../ausencias/portas";
import { ErroPortaBitrix } from "./erros";
import type { CodigoErroBitrix } from "./erros";
import {
  dataISOValida,
  diasNoMes,
  escaparBBCode,
  exigirIntervalo,
  exigirInteiroPositivo,
  exigirMarcador,
} from "./util";

export type ChamadaRest = (
  metodo: string,
  parametros: Record<string, unknown>,
) => Promise<{ result?: unknown }>;

export interface OpcoesBitrixReal {
  /** Chamada REST. Default: `callRest` do cliente existente no portal ativo. */
  chamar?: ChamadaRest;
  /** Ambiente (default `process.env`). So `BITRIX_ESCRITA` e lido. */
  env?: Record<string, string | undefined>;
  /** Se informado, escrita exige tambem `true` aqui (portal marcado de teste). */
  portalDeTeste?: () => boolean;
  /** Offset ISO-8601 de `from`/`to`. Default `-03:00` (Brasilia). */
  offset?: string;
  /** Relogio em ms (cache do calendario). */
  agoraMs?: () => number;
  /** Ano usado para expandir `year_workdays` (recorrente) em datas. */
  anoReferencia?: () => number;
  /** TTL do cache de `calendar.settings.get`. Default 10 min. */
  ttlCalendarioMs?: number;
}

const TTL_PADRAO_MS = 10 * 60 * 1000;
const RE_OFFSET = /^[+-]\d{2}:\d{2}$/;

export class BitrixReal implements PortaBitrix {
  readonly modo = "real" as const;

  private chamarRest: ChamadaRest;
  private env: Record<string, string | undefined>;
  private portalDeTeste: (() => boolean) | undefined;
  private offset: string;
  private agoraMs: () => number;
  private anoReferencia: () => number;
  private ttlMs: number;
  private cache: { ate: number; valor: CalendarioTrabalho } | null = null;

  constructor(opcoes: OpcoesBitrixReal = {}) {
    this.chamarRest = opcoes.chamar ?? chamadaPadrao;
    this.env = opcoes.env ?? process.env;
    this.portalDeTeste = opcoes.portalDeTeste;
    this.offset = opcoes.offset ?? "-03:00";
    if (!RE_OFFSET.test(this.offset)) {
      throw new ErroPortaBitrix("ENTRADA_INVALIDA", "offset deve ser +HH:MM ou -HH:MM");
    }
    this.agoraMs = opcoes.agoraMs ?? (() => Date.now());
    this.anoReferencia = opcoes.anoReferencia ?? (() => new Date().getFullYear());
    this.ttlMs = opcoes.ttlCalendarioMs ?? TTL_PADRAO_MS;
  }

  private exigirEscrita(): void {
    if (this.env.BITRIX_ESCRITA !== "1") {
      throw new ErroPortaBitrix(
        "ESCRITA_BLOQUEADA",
        "Escrita no portal Bitrix24 desligada: defina BITRIX_ESCRITA=1 (apenas em portal de teste).",
      );
    }
    if (this.portalDeTeste && !this.portalDeTeste()) {
      throw new ErroPortaBitrix(
        "ESCRITA_BLOQUEADA",
        "Escrita bloqueada: o portal ativo nao esta marcado como portal de teste.",
      );
    }
  }

  /** Chamada REST com erros traduzidos para ErroPortaBitrix (sem URL/token). */
  private async rest(metodo: string, parametros: Record<string, unknown>): Promise<unknown> {
    try {
      const resposta = await this.chamarRest(metodo, parametros);
      return resposta?.result;
    } catch (erro) {
      throw traduzirErro(erro);
    }
  }

  async buscarEvento(
    marcador: string,
    ownerId: number,
    inicio: DataISO,
    fim: DataISO,
  ): Promise<{ id: string } | null> {
    exigirMarcador(marcador);
    exigirInteiroPositivo(ownerId, "ownerId");
    exigirIntervalo(inicio, fim);
    const resultado = await this.rest("calendar.event.get", {
      type: "user",
      ownerId,
      from: inicio,
      to: fim,
    });
    if (resultado === undefined || resultado === null) return null;
    if (!Array.isArray(resultado)) {
      throw new ErroPortaBitrix("RESPOSTA_INVALIDA", "calendar.event.get: resposta inesperada");
    }
    for (const bruto of resultado) {
      if (bruto === null || typeof bruto !== "object") continue;
      const item = bruto as Record<string, unknown>;
      if (item.DELETED === "Y" || item.DELETED === true) continue;
      const descricao = typeof item.DESCRIPTION === "string" ? item.DESCRIPTION : "";
      // `[BR24:1]` nao e substring de `[BR24:12]`: o `]` fecha o marcador.
      if (!descricao.includes(marcador)) continue;
      const id = item.ID;
      if (typeof id === "string" || typeof id === "number") return { id: String(id) };
    }
    return null;
  }

  async criarEvento(evento: EventoCalendarioBitrix): Promise<{ id: string; secao?: number }> {
    this.exigirEscrita();
    exigirMarcador(evento.marcador);
    exigirInteiroPositivo(evento.ownerId, "ownerId");
    exigirIntervalo(evento.inicio, evento.fim);
    if (evento.nome !== NOME_EVENTO_BITRIX) {
      throw new ErroPortaBitrix("ENTRADA_INVALIDA", "nome do evento deve ser o rotulo neutro");
    }
    const resultado = await this.rest("calendar.event.add", {
      type: "user",
      ownerId: evento.ownerId,
      from: `${evento.inicio}T00:00:00${this.offset}`,
      to: `${evento.fim}T23:59:59${this.offset}`,
      skip_time: "Y",
      accessibility: "absent",
      name: NOME_EVENTO_BITRIX,
      description: evento.marcador,
      auto_detect_section: "Y",
    });
    if (typeof resultado !== "string" && typeof resultado !== "number") {
      // Pode ter criado: o executor busca o marcador antes de repetir.
      throw new ErroPortaBitrix("RESPOSTA_INVALIDA", "calendar.event.add sem id na resposta", true);
    }
    const id = String(resultado);
    return { id, secao: await this.secaoDoEvento(id) };
  }

  /** Melhor esforco: o evento ja existe; falhar aqui nao pode derrubar a criacao. */
  private async secaoDoEvento(id: string): Promise<number | undefined> {
    try {
      const evento = await this.rest("calendar.event.getbyid", { id });
      if (evento && typeof evento === "object") {
        const bruto = (evento as Record<string, unknown>).SECTION_ID;
        const n = Number(bruto);
        if (Number.isSafeInteger(n) && n > 0) return n;
      }
    } catch {
      // ignorado de proposito
    }
    return undefined;
  }

  async removerEvento(id: string, ownerId: number): Promise<void> {
    this.exigirEscrita();
    exigirInteiroPositivo(ownerId, "ownerId");
    if (typeof id !== "string" || !/^\d+$/.test(id)) {
      throw new ErroPortaBitrix("ENTRADA_INVALIDA", "id do evento invalido");
    }
    try {
      await this.chamarRest("calendar.event.delete", { id });
    } catch (erro) {
      if (!pareceNaoEncontrado(erro)) throw traduzirErro(erro);
      // client.ts, em modo webhook, converte NOT_FOUND em "credenciais invalidas".
      // Confirma com uma leitura barata que as credenciais estao boas: se a
      // leitura passa, o evento realmente nao existe e o delete e sucesso.
      try {
        await this.chamarRest("calendar.settings.get", {});
      } catch (confirmacao) {
        throw traduzirErro(confirmacao);
      }
    }
  }

  async calendarioTrabalho(): Promise<CalendarioTrabalho> {
    const agora = this.agoraMs();
    if (this.cache && this.cache.ate > agora) return copiar(this.cache.valor);
    const bruto = await this.rest("calendar.settings.get", {});
    if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) {
      throw new ErroPortaBitrix("RESPOSTA_INVALIDA", "calendar.settings.get: resposta inesperada");
    }
    const valor = converterCalendario(bruto as Record<string, unknown>, this.anoReferencia());
    this.cache = { ate: agora + this.ttlMs, valor };
    return copiar(valor);
  }

  async notificar(bitrixUserId: number, mensagem: string): Promise<void> {
    this.exigirEscrita();
    exigirInteiroPositivo(bitrixUserId, "bitrixUserId");
    // Sem TAG: tag repetida apaga as outras notificacoes com a mesma tag.
    await this.rest("im.notify.system.add", {
      USER_ID: bitrixUserId,
      MESSAGE: escaparBBCode(mensagem),
    });
  }
}

/* ------------------------------------------------------------ conversoes */

/**
 * `year_holidays` "1.01,2.01" (D.M) -> ["01-01","01-02"]; com ano (D.M.AAAA) -> "AAAA-MM-DD".
 * `year_workdays` e recorrente tambem: expandido em datas ISO de ano-1..ano+2,
 * porque `CalendarioTrabalho.excecoesTrabalhadas` exige DataISO.
 */
export function converterCalendario(
  bruto: Record<string, unknown>,
  anoReferencia: number,
): CalendarioTrabalho {
  const feriados: string[] = [];
  for (const item of dividirLista(bruto.year_holidays)) {
    const m = analisarDiaMes(item);
    if (!m) continue;
    feriados.push(m.ano ? `${m.ano}-${m.mes}-${m.dia}` : `${m.mes}-${m.dia}`);
  }

  const excecoes: string[] = [];
  for (const item of dividirLista(bruto.year_workdays)) {
    const m = analisarDiaMes(item);
    if (!m) continue;
    if (m.ano) {
      excecoes.push(`${m.ano}-${m.mes}-${m.dia}`);
      continue;
    }
    for (let ano = anoReferencia - 1; ano <= anoReferencia + 2; ano += 1) {
      const data = `${String(ano).padStart(4, "0")}-${m.mes}-${m.dia}`;
      if (dataISOValida(data)) excecoes.push(data);
    }
  }

  let diasNaoUteis = ["SA", "SU"];
  const semana = bruto.week_holidays;
  if (Array.isArray(semana)) {
    diasNaoUteis = semana.map((d) => String(d).toUpperCase().trim()).filter(Boolean);
  } else if (typeof semana === "string" && semana.trim() !== "") {
    diasNaoUteis = dividirLista(semana).map((d) => d.toUpperCase());
  }

  return {
    diasNaoUteis,
    feriados: [...new Set(feriados)],
    excecoesTrabalhadas: [...new Set(excecoes)].sort(),
  };
}

function dividirLista(valor: unknown): string[] {
  if (typeof valor !== "string") return [];
  return valor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function analisarDiaMes(item: string): { dia: string; mes: string; ano?: string } | null {
  const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(item);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1) return null;
  // Ano 2000 (bissexto) valida 29.02 como feriado recorrente.
  const ano = m[3] ? Number(m[3]) : 2000;
  if (dia > diasNoMes(ano, mes)) return null;
  return {
    dia: String(dia).padStart(2, "0"),
    mes: String(mes).padStart(2, "0"),
    ano: m[3],
  };
}

function copiar(c: CalendarioTrabalho): CalendarioTrabalho {
  return {
    diasNaoUteis: [...c.diasNaoUteis],
    feriados: [...c.feriados],
    excecoesTrabalhadas: [...c.excecoesTrabalhadas],
  };
}

/* ------------------------------------------------------------------ erros */

function pareceNaoEncontrado(erro: unknown): boolean {
  if (erro instanceof ErroPortaBitrix) return erro.codigo === "NOT_FOUND";
  const texto = erro instanceof Error ? erro.message : String(erro);
  const codigo = (erro as { codigo?: unknown } | null)?.codigo;
  return (
    codigo === "NAO_ENCONTRADO" ||
    /NOT_FOUND|EVENT_NOT_FOUND|nao encontrad/i.test(texto)
  );
}

const CODIGOS_CLIENTE: Record<string, CodigoErroBitrix> = {
  PORTAL_INDISPONIVEL: "TRANSITORIO",
  LIMITE_API: "LIMITE_API",
  SEM_PERMISSAO: "SEM_PERMISSAO",
  CREDENCIAIS_INVALIDAS: "CREDENCIAIS_INVALIDAS",
  TOKEN_EXPIRADO: "CREDENCIAIS_INVALIDAS",
  SEM_CONFIGURACAO: "SEM_PORTAL",
  RESPOSTA_INVALIDA: "RESPOSTA_INVALIDA",
};

/** Converte o AppError do client.ts em ErroPortaBitrix usando so a mensagem de usuario. */
function traduzirErro(erro: unknown): ErroPortaBitrix {
  if (erro instanceof ErroPortaBitrix) return erro;
  const duck = erro as { codigo?: unknown; mensagemUsuario?: unknown } | null;
  if (duck && typeof duck.codigo === "string" && typeof duck.mensagemUsuario === "string") {
    const codigo = CODIGOS_CLIENTE[duck.codigo] ?? "ERRO_BITRIX";
    return new ErroPortaBitrix(codigo, `${duck.codigo}: ${duck.mensagemUsuario}`);
  }
  return new ErroPortaBitrix("TRANSITORIO", erro instanceof Error ? erro.message : "falha desconhecida");
}

/* -------------------------------------------------------- chamada padrao */

const chamadaPadrao: ChamadaRest = async (metodo, parametros) => {
  const { portalAtivo } = await import("@/lib/db/portals");
  const portal = portalAtivo();
  if (!portal) {
    throw new ErroPortaBitrix("SEM_PORTAL", "Nenhum portal Bitrix24 configurado.");
  }
  const { callRest } = await import("@/lib/bitrix/client");
  return callRest(portal.memberId, metodo, parametros);
};
