/**
 * FakeBitrix: implementacao EM MEMORIA de PortaBitrix.
 *
 * ROTULADO COMO SIMULADO: nada aqui fala com um portal Bitrix24. E o padrao do
 * pitch quando nao ha portal de teste (BR24-005 v2.2, item 12). A UI deve
 * exibir `ROTULO_BITRIX_SIMULADO` sempre que a porta ativa for este fake.
 *
 * O fake se comporta como o Bitrix real em um ponto importante: `criarEvento`
 * NAO e idempotente (dois adds = dois eventos). Quem garante "sem duplicar" e o
 * executor (busca do marcador + serializacao por pedido), e os testes provam isso.
 *
 * Injecao de falhas (contadores "as proximas N chamadas"):
 *   - timeoutPosCriacao: cria o evento e depois lanca TIMEOUT (resultado incerto);
 *   - transitorioCriar / transitorioBuscar / transitorioRemover: erro antes de agir;
 *   - notFoundNoDelete: o remover lanca NOT_FOUND (adaptador que vaza o erro).
 *
 * Payloads guardados NUNCA incluem campos alem dos do contrato: o evento e
 * copiado campo a campo, entao justificativa/motivo nao tem como entrar.
 */
import { NOME_EVENTO_BITRIX } from "../../ausencias/tipos";
import type { CalendarioTrabalho, DataISO } from "../../ausencias/tipos";
import type { EventoCalendarioBitrix, PortaBitrix } from "../../ausencias/portas";
import { ErroPortaBitrix } from "./erros";
import {
  escaparBBCode,
  exigirIntervalo,
  exigirInteiroPositivo,
  exigirMarcador,
} from "./util";

/** Rotulo exibido na UI/logs quando a porta e o fake. */
export const ROTULO_BITRIX_SIMULADO = "simulado";

export interface FalhasInjetaveis {
  timeoutPosCriacao?: number;
  transitorioCriar?: number;
  transitorioBuscar?: number;
  transitorioRemover?: number;
  notFoundNoDelete?: number;
}

export interface EventoGuardado {
  id: string;
  marcador: string;
  ownerId: number;
  inicio: DataISO;
  fim: DataISO;
  nome: string;
  /** Somente o marcador, como no adaptador real. */
  description: string;
  accessibility: "absent";
  skipTime: "Y";
}

export interface ChamadaRegistrada {
  operacao: "buscarEvento" | "criarEvento" | "removerEvento" | "calendarioTrabalho" | "notificar";
  /** Copia do que cruzou a porta (sem nada fora do contrato). */
  payload: Record<string, unknown>;
}

export interface Notificacao {
  bitrixUserId: number;
  /** Ja com BBCode escapado, como iria no fio. */
  mensagem: string;
}

export interface OpcoesFakeBitrix {
  calendario?: CalendarioTrabalho;
  falhas?: FalhasInjetaveis;
}

/** Feriados nacionais fixos (publicos) usados so como dado fixo do fake. */
const CALENDARIO_PADRAO: CalendarioTrabalho = {
  diasNaoUteis: ["SA", "SU"],
  feriados: ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"],
  excecoesTrabalhadas: [],
};

function cederVez(): Promise<void> {
  return new Promise((resolver) => setImmediate(resolver));
}

export class FakeBitrix implements PortaBitrix {
  readonly modo = "simulado" as const;
  readonly rotulo = ROTULO_BITRIX_SIMULADO;

  private armazenados = new Map<string, EventoGuardado>();
  private registro: ChamadaRegistrada[] = [];
  private caixa: Notificacao[] = [];
  private proximoId = 1000;
  private falhas: Required<FalhasInjetaveis> = semFalhas();
  private calendario: CalendarioTrabalho;

  constructor(opcoes: OpcoesFakeBitrix = {}) {
    this.calendario = copiarCalendario(opcoes.calendario ?? CALENDARIO_PADRAO);
    if (opcoes.falhas) this.injetar(opcoes.falhas);
  }

  /** Soma (nao substitui) as falhas das proximas chamadas. */
  injetar(falhas: FalhasInjetaveis): void {
    for (const chave of Object.keys(falhas) as (keyof FalhasInjetaveis)[]) {
      const n = falhas[chave] ?? 0;
      if (!Number.isInteger(n) || n < 0) throw new Error(`falha ${chave}: contador invalido`);
      this.falhas[chave] += n;
    }
  }

  reiniciar(): void {
    this.armazenados.clear();
    this.registro = [];
    this.caixa = [];
    this.falhas = semFalhas();
    this.proximoId = 1000;
  }

  /** Eventos hoje existentes no calendario simulado (copias). */
  eventos(): EventoGuardado[] {
    return [...this.armazenados.values()].map((e) => ({ ...e }));
  }

  /** Todas as chamadas recebidas, em ordem (copias). */
  chamadas(): ChamadaRegistrada[] {
    return this.registro.map((c) => ({ operacao: c.operacao, payload: { ...c.payload } }));
  }

  notificacoes(): Notificacao[] {
    return this.caixa.map((n) => ({ ...n }));
  }

  /** Tudo que o fake guardou ou recebeu, serializado: usado pelo teste de sentinela. */
  serializar(): string {
    return JSON.stringify({
      eventos: this.eventos(),
      chamadas: this.chamadas(),
      notificacoes: this.notificacoes(),
    });
  }

  private consumir(chave: keyof FalhasInjetaveis): boolean {
    if (this.falhas[chave] > 0) {
      this.falhas[chave] -= 1;
      return true;
    }
    return false;
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
    this.registro.push({ operacao: "buscarEvento", payload: { marcador, ownerId, inicio, fim } });
    await cederVez();
    if (this.consumir("transitorioBuscar")) {
      throw new ErroPortaBitrix("TRANSITORIO", "falha transitoria simulada ao buscar evento");
    }
    for (const e of this.armazenados.values()) {
      if (
        e.marcador === marcador &&
        e.ownerId === ownerId &&
        e.inicio <= fim &&
        e.fim >= inicio
      ) {
        return { id: e.id };
      }
    }
    return null;
  }

  async criarEvento(evento: EventoCalendarioBitrix): Promise<{ id: string; secao?: number }> {
    // Copia campo a campo: qualquer propriedade extra do objeto recebido e descartada.
    const payload = {
      marcador: evento.marcador,
      ownerId: evento.ownerId,
      inicio: evento.inicio,
      fim: evento.fim,
      nome: evento.nome,
    };
    exigirMarcador(payload.marcador);
    exigirInteiroPositivo(payload.ownerId, "ownerId");
    exigirIntervalo(payload.inicio, payload.fim);
    if (payload.nome !== NOME_EVENTO_BITRIX) {
      throw new ErroPortaBitrix("ENTRADA_INVALIDA", "nome do evento deve ser o rotulo neutro");
    }
    this.registro.push({ operacao: "criarEvento", payload: { ...payload } });
    await cederVez();
    if (this.consumir("transitorioCriar")) {
      throw new ErroPortaBitrix("TRANSITORIO", "falha transitoria simulada ao criar evento");
    }
    const id = String(this.proximoId++);
    this.armazenados.set(id, {
      id,
      marcador: payload.marcador,
      ownerId: payload.ownerId,
      inicio: payload.inicio,
      fim: payload.fim,
      nome: payload.nome,
      description: payload.marcador,
      accessibility: "absent",
      skipTime: "Y",
    });
    if (this.consumir("timeoutPosCriacao")) {
      throw new ErroPortaBitrix("TIMEOUT", "timeout simulado apos a criacao (resultado incerto)");
    }
    return { id, secao: 1 };
  }

  async removerEvento(id: string, ownerId: number): Promise<void> {
    exigirInteiroPositivo(ownerId, "ownerId");
    if (typeof id !== "string" || id.length === 0) {
      throw new ErroPortaBitrix("ENTRADA_INVALIDA", "id do evento invalido");
    }
    this.registro.push({ operacao: "removerEvento", payload: { id, ownerId } });
    await cederVez();
    if (this.consumir("transitorioRemover")) {
      throw new ErroPortaBitrix("TRANSITORIO", "falha transitoria simulada ao remover evento");
    }
    if (this.consumir("notFoundNoDelete")) {
      this.armazenados.delete(id);
      throw new ErroPortaBitrix("NOT_FOUND", "evento nao encontrado (simulado)");
    }
    // Contrato da porta: remover o que nao existe e sucesso.
    this.armazenados.delete(id);
  }

  async calendarioTrabalho(): Promise<CalendarioTrabalho> {
    this.registro.push({ operacao: "calendarioTrabalho", payload: {} });
    await cederVez();
    return copiarCalendario(this.calendario);
  }

  async notificar(bitrixUserId: number, mensagem: string): Promise<void> {
    exigirInteiroPositivo(bitrixUserId, "bitrixUserId");
    const escapada = escaparBBCode(mensagem);
    this.registro.push({ operacao: "notificar", payload: { bitrixUserId, mensagem: escapada } });
    await cederVez();
    this.caixa.push({ bitrixUserId, mensagem: escapada });
  }
}

function semFalhas(): Required<FalhasInjetaveis> {
  return {
    timeoutPosCriacao: 0,
    transitorioCriar: 0,
    transitorioBuscar: 0,
    transitorioRemover: 0,
    notFoundNoDelete: 0,
  };
}

function copiarCalendario(c: CalendarioTrabalho): CalendarioTrabalho {
  return {
    diasNaoUteis: [...c.diasNaoUteis],
    feriados: [...c.feriados],
    excecoesTrabalhadas: [...c.excecoesTrabalhadas],
  };
}
