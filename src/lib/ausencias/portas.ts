/**
 * Portas (interfaces) entre o dominio puro e o resto. Implementacoes:
 *   Relogio / repositorios / servicos -> C2 (SQLite)
 *   PortaBitrix real e fake           -> C3
 * O dominio e a UI dependem so destas assinaturas, o que permite C1, C3-fake e
 * C4 (com fixtures) andarem em paralelo.
 */
import { NOME_EVENTO_BITRIX } from "./tipos";
import type {
  DataISO,
  Lancamento,
  Pedido,
  Pessoa,
  SessaoDemo,
  Tipo,
  Equipe,
  Etapa,
  CalendarioTrabalho,
} from "./tipos";

export interface EventoCalendarioBitrix {
  /** Marcador `[BR24:<pedidoId>]` gravado na description (idempotencia). */
  marcador: string;
  ownerId: number;
  inicio: DataISO;
  fim: DataISO;
  /** Sempre "Ausente": nunca o tipo real nem texto livre. */
  nome: typeof NOME_EVENTO_BITRIX;
}

export interface PortaBitrix {
  /** Procura por marcador antes de reenviar um add de resultado incerto. */
  buscarEvento(marcador: string, ownerId: number, inicio: DataISO, fim: DataISO): Promise<{ id: string } | null>;
  criarEvento(evento: EventoCalendarioBitrix): Promise<{ id: string; secao?: number }>;
  /** NOT_FOUND conta como sucesso. */
  removerEvento(id: string, ownerId: number): Promise<void>;
  calendarioTrabalho(): Promise<CalendarioTrabalho>;
  notificar(bitrixUserId: number, mensagem: string): Promise<void>;
}

export interface Notificador {
  /** Grava na caixa do app; chave unica (pessoa, pedido, etapa). */
  gravar(pessoaId: string, pedidoId: number, etapa: string, texto: string): void;
}

export interface RepositorioAusencias {
  pessoa(sessao: SessaoDemo): Pessoa | null;
  tipos(): Tipo[];
  equipes(): Equipe[];
  etapas(): Etapa[];
  pedidosVisiveis(sessao: SessaoDemo): Pedido[];
  lancamentos(pessoaId: string): Lancamento[];
}
