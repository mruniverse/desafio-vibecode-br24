/**
 * DTOs de visao: o QUE cada papel enxerga. Todo dado que sai da API passa por
 * `paraVisao` (C2); tipo sensivel aparece sempre como ROTULO_PUBLICO_SENSIVEL e
 * nunca carrega justificativa nem motivo para quem nao e dono/admin.
 */
import type {
  Carteira,
  ChaveEtapa,
  DataISO,
  InstanteISO,
  Papel,
  StatusPedido,
  StatusSincronizacao,
} from "./tipos";

export interface PessoaVisao {
  id: string;
  nome: string;
  equipeId: string;
  papel: Papel;
  funcao?: string;
}

export interface PedidoVisao {
  id: number;
  pessoa: PessoaVisao;
  /** Rotulo publico; "Ausência" quando o tipo e sensivel e o leitor nao e dono/admin. */
  tipo: string;
  tipoSensivel: boolean;
  inicio: DataISO;
  fim: DataISO;
  diasUteis: number;
  status: StatusPedido;
  sincronizacao: StatusSincronizacao;
  etapa: ChaveEtapa;
  etapaRotulo: string;
  excedeSaldo: boolean;
  /** So para dono/admin (tipo comum: gestor tambem). */
  justificativa?: string;
  motivoPrivado?: string;
  motivoDecisao?: string;
  sugestao?: { inicio: DataISO; fim: DataISO };
  prazoEm?: InstanteISO;
  criadoEm: InstanteISO;
  versao: number;
  aprovador?: PessoaVisao;
  /** Acoes que ESTA sessao pode fazer agora (a UI so desenha o que vier aqui). */
  permitido: { cancelar: boolean; decidir: boolean };
}

export interface SaldoVisao {
  carteira: Carteira;
  disponivel: number;
  /** Dias que vencem em ate 90 dias e ainda nao foram consumidos. */
  vencendo: { dias: number; venceEm: DataISO } | null;
}

export interface DiaCalendarioVisao {
  data: DataISO;
  util: boolean;
  feriado: boolean;
  trabalhando: number;
  abaixoDoMinimo: boolean;
}

export interface AusenciaCalendarioVisao {
  pedidoId: number;
  pessoaId: string;
  inicio: DataISO;
  fim: DataISO;
  /** Nome do tipo; "Ausência" se sensivel. */
  rotulo: string;
  cor: string;
  pendente: boolean;
}

export interface CalendarioVisao {
  equipeId: string;
  de: DataISO;
  ate: DataISO;
  pessoas: PessoaVisao[];
  ausencias: AusenciaCalendarioVisao[];
  dias: DiaCalendarioVisao[];
}

export interface SemanaPiorDiaVisao {
  semanaInicio: DataISO;
  semPedido: number;
  comPedido: number;
}

export interface DisponibilidadeVisao {
  equipeId: string;
  minimoPessoas: number;
  contarPendentes: boolean;
  totalMembros: number;
  dias: DiaCalendarioVisao[];
  diasAbaixoDoMinimo: number;
  piorDia: { data: DataISO; trabalhando: number } | null;
  atencao: { pedidoId: number; texto: string }[];
}

export interface ImpactoPedidoVisao {
  pedidoId: number;
  semanas: SemanaPiorDiaVisao[];
  tambemForaNoPeriodo: { pessoa: PessoaVisao; inicio: DataISO; fim: DataISO }[];
  saldoAntes: number;
  saldoDepois: number;
  foraUltimos12Meses: number;
  alternativas: { inicio: DataISO; fim: DataISO; motivo: string }[];
}

export interface PainelVisao {
  escopo: "empresa" | "equipe";
  porStatus: Record<StatusPedido, number>;
  aguardandoGestor: { total: number; atrasados: number };
  diasPorTipo: { rotulo: string; dias: number }[];
  feriasVencendo: { pessoa: PessoaVisao; dias: number; venceEm: DataISO }[];
  diasAbaixoDoMinimoPorEquipe: { equipeId: string; nome: string; dias: number }[];
  taxaAprovacao: number | null;
  tempoMedioDecisaoHoras: number | null;
}

export interface NotificacaoVisao {
  id: number;
  pedidoId: number;
  etapa: string;
  texto: string;
  criadaEm: InstanteISO;
  lida: boolean;
}

export interface SincronizacaoLogVisao {
  pedidoId: number;
  operacao: "adicionar" | "remover";
  estado: string;
  tentativas: number;
  quando: InstanteISO;
  erro?: string;
}
