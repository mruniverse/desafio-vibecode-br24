/**
 * Contrato dos servicos de ausencias (BR24-005). Implementacao: C2.
 * Consumidores: rotas e telas do C4. Toda operacao recebe a SESSAO (papel e
 * pessoa vem do cookie + banco, nunca do corpo) e valida autorizacao por
 * dentro; negado = ErroDominio sem efeito colateral.
 */
import type { z } from "zod";
import type { creditarSchema, criarPedidoSchema, decidirPedidoSchema, etapaSchema, minimoEquipeSchema } from "./schemas";
import type { DataISO, Etapa, Equipe, SessaoDemo, Tipo } from "./tipos";
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
} from "./visoes";

export type EntradaCriarPedido = z.infer<typeof criarPedidoSchema>;
export type EntradaDecidir = z.infer<typeof decidirPedidoSchema>;
export type EntradaCreditar = z.infer<typeof creditarSchema>;
export type EntradaEtapa = z.infer<typeof etapaSchema>;
export type EntradaMinimo = z.infer<typeof minimoEquipeSchema>;

export interface PreviaPedido {
  diasUteis: number;
  diasDebitoPorAno: Record<string, number>;
  excedeSaldo: boolean;
  saldoDepois: number;
  aprovador: PessoaVisao;
  conflitoEquipe: boolean;
  datasLivres: { inicio: DataISO; fim: DataISO }[];
}

export interface ServicosAusencias {
  eu(sessao: SessaoDemo): PessoaVisao;
  tiposPediveis(sessao: SessaoDemo): Tipo[];
  /** Calcula dias, saldo, conflito e datas livres SEM gravar. */
  previa(sessao: SessaoDemo, entrada: EntradaCriarPedido): PreviaPedido;
  solicitar(sessao: SessaoDemo, entrada: EntradaCriarPedido): Promise<PedidoVisao>;
  decidir(sessao: SessaoDemo, pedidoId: number, entrada: EntradaDecidir): Promise<PedidoVisao>;
  cancelar(sessao: SessaoDemo, pedidoId: number): Promise<PedidoVisao>;
  meusPedidos(sessao: SessaoDemo): PedidoVisao[];
  paraAprovar(sessao: SessaoDemo): PedidoVisao[];
  pedido(sessao: SessaoDemo, pedidoId: number): PedidoVisao;
  impacto(sessao: SessaoDemo, pedidoId: number): ImpactoPedidoVisao;
  saldos(sessao: SessaoDemo): SaldoVisao[];
  creditar(sessao: SessaoDemo, entrada: EntradaCreditar): void;
  calendario(sessao: SessaoDemo, equipeId: string, de: DataISO, ate: DataISO): CalendarioVisao;
  disponibilidade(sessao: SessaoDemo, equipeId: string, de: DataISO, ate: DataISO): DisponibilidadeVisao;
  painel(sessao: SessaoDemo, equipeId?: string): PainelVisao;
  notificacoes(sessao: SessaoDemo): NotificacaoVisao[];
  lembrarGestor(sessao: SessaoDemo, pedidoId: number): void;
  etapas(): Etapa[];
  editarEtapa(sessao: SessaoDemo, entrada: EntradaEtapa): Etapa[];
  equipes(sessao: SessaoDemo): Equipe[];
  definirMinimo(sessao: SessaoDemo, equipeId: string, entrada: EntradaMinimo): Equipe;
  /** Log de sincronizacao (Configuracoes -> Bitrix24). */
  logSincronizacao(sessao: SessaoDemo): SincronizacaoLogVisao[];
  reprocessarSincronizacao(sessao: SessaoDemo, pedidoId?: number): Promise<void>;
}
