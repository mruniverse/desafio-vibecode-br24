/**
 * Contratos de dados de Gestao de Ferias e Ausencias (BR24-005 v2.1).
 *
 * Datas sao strings ISO `YYYY-MM-DD` (sem fuso), intervalo INCLUSIVO.
 * Funcoes de dominio sao puras: nada de Date.now()/new Date() — `hoje`/`agora`
 * entram por parametro. Sem `enum` (strip-types): uniao de strings.
 */

export type DataISO = string; // YYYY-MM-DD
export type InstanteISO = string; // YYYY-MM-DDTHH:MM:SS.sssZ

export type Papel = "colaborador" | "gestor" | "admin";
export type Carteira = "ferias" | "folga";

export type StatusPedido = "pendente" | "aprovada" | "recusada" | "cancelada";

/** Estado da espelhagem no calendario do Bitrix, separado da decisao. */
export type StatusSincronizacao =
  | "nao_aplicavel"
  | "pendente"
  | "em_andamento"
  | "ok"
  | "falha"
  | "remocao_pendente"
  | "removido"
  | "falha_manual";

export type ChaveEtapa = "enviado" | "com_gestor" | "confirmado" | "recusado";

export interface Tipo {
  id: string;
  nome: string;
  quemPede: "todos" | "admin";
  consomeSaldo: Carteira | null;
  /** Dado de saude: justificativa proibida, rotulo publico "Ausencia". */
  sensivel: boolean;
  cor: string;
}

export interface Equipe {
  id: string;
  nome: string;
  gestorId: string;
  minimoPessoas: number;
  contarPendentes: boolean;
}

export interface Pessoa {
  id: string;
  nome: string;
  equipeId: string;
  papel: Papel;
  /** Quem aprova os pedidos desta pessoa (nunca ela mesma). */
  aprovadorId: string;
  funcao?: string;
  bitrixUserId?: number;
}

export interface Pedido {
  id: string;
  pessoaId: string;
  tipoId: string;
  inicio: DataISO;
  fim: DataISO;
  /** Congelado na criacao, calculado no servidor. */
  diasUteis: number;
  status: StatusPedido;
  sincronizacao: StatusSincronizacao;
  /** Visivel ao gestor. Proibida em tipo sensivel. */
  justificativa?: string;
  /** Cifrado em repouso; so o dono e o admin veem. */
  motivoPrivado?: string;
  excedeSaldo: boolean;
  motivoDecisao?: string;
  sugestao?: { inicio: DataISO; fim: DataISO };
  prazoEm?: InstanteISO;
  criadoEm: InstanteISO;
  decididoPor?: string;
  decididoEm?: InstanteISO;
  bitrixEventId?: string;
  ownerId?: number;
  secao?: number;
  versao: number;
}

/** Credito ou ajuste. O debito e DERIVADO dos pedidos, nao persistido. */
export interface Lancamento {
  id: string;
  pessoaId: string;
  carteira: Carteira;
  tipo: "credito" | "ajuste";
  dias: number;
  motivo: string;
  venceEm?: DataISO;
  criadoPor: string;
  criadoEm: InstanteISO;
}

export interface Etapa {
  chave: ChaveEtapa;
  rotulo: string;
  /** So variaveis da whitelist: {nome} {periodo} {tipoPublico} {prazo}. */
  mensagem: string;
  prazoHoras?: number;
}

export interface Relogio {
  agora(): InstanteISO;
  hoje(): DataISO;
}

/** Calendario de trabalho do portal (calendar.settings.get). */
export interface CalendarioTrabalho {
  /** Dias da semana nao uteis: 'SA','SU',... Padrao quando ausente: SA,SU. */
  diasNaoUteis: string[];
  /** Feriados fixos 'MM-DD' e do ano 'YYYY-MM-DD'. */
  feriados: string[];
  /** Dias normalmente de folga trabalhados. */
  excecoesTrabalhadas: DataISO[];
}

export interface SessaoDemo {
  pessoaId: string;
  papel: Papel;
}
