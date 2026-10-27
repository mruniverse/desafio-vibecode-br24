/**
 * PONTO UNICO DE TROCA do C4 -> C2.
 *
 * Provedor de servicos "em memoria com fixtures" (dados ficticios, estado no
 * processo, some ao reiniciar). Implementa `ServicosAusencias` (contrato do C0b).
 * Quando o C2 existir, so este arquivo muda: `obterServicos()` passa a devolver
 * os servicos reais e `obterApoioDemo()` le pessoas/papel do banco. As rotas
 * nao importam mais nada daqui alem destas duas funcoes.
 *
 * Regras que o C2 tambem precisa cumprir (e que este provedor ja simula):
 * - papel/pessoa vem SEMPRE da sessao + cadastro, nunca do corpo;
 * - negado em recurso por id = NAO_ENCONTRADO (404), sem efeito colateral;
 * - tipo sensivel: rotulo publico "Ausência", sem justificativa para gestor;
 * - conflito de equipe informa, nunca bloqueia; so `status` governa cobertura e saldo.
 *
 * Sem enum/namespace/propriedade de parametro (strip-types dos testes).
 */
import type {
  EntradaCreditar,
  EntradaCriarPedido,
  EntradaDecidir,
  EntradaEtapa,
  EntradaMinimo,
  PreviaPedido,
  ServicosAusencias,
} from "@/lib/ausencias/servicos";
import { ROTULO_PUBLICO_SENSIVEL } from "@/lib/ausencias/tipos";
import type {
  Carteira,
  ChaveEtapa,
  DataISO,
  Equipe,
  Etapa,
  InstanteISO,
  Lancamento,
  Papel,
  Pedido,
  Pessoa,
  SessaoDemo,
  StatusPedido,
  Tipo,
} from "@/lib/ausencias/tipos";
import type {
  AusenciaCalendarioVisao,
  CalendarioVisao,
  DiaCalendarioVisao,
  DisponibilidadeVisao,
  ImpactoPedidoVisao,
  NotificacaoVisao,
  PainelVisao,
  PedidoVisao,
  PessoaVisao,
  SaldoVisao,
  SemanaPiorDiaVisao,
  SincronizacaoLogVisao,
} from "@/lib/ausencias/visoes";
import {
  curto,
  debitoPorAno,
  diasUteisEntre,
  diferencaDias,
  ehFeriado,
  ehUtil,
  intervalo,
  periodoCurto,
  segundaDaSemana,
  somarDias,
  sobrepoe,
} from "./_calculos";
import { conflito, erroCampo, naoEncontrado, semPermissao } from "./_erros";
import { EQUIPES, ETAPAS, HOJE_DEMO, PESSOAS, TIPOS } from "./_fixtures";

/** Cor neutra para ausencia sensivel: a cor do tipo revelaria o tipo. */
const COR_NEUTRA = "#94A3B8";
const ROTULO_PLURAL_SENSIVEL = "Ausências";

interface Notif extends NotificacaoVisao {
  pessoaId: string;
}

interface Estado {
  equipes: Equipe[];
  pessoas: Pessoa[];
  tipos: Tipo[];
  pedidos: Pedido[];
  lancamentos: Lancamento[];
  etapas: Etapa[];
  notificacoes: Notif[];
  log: SincronizacaoLogVisao[];
  proximoPedido: number;
  proximoLancamento: number;
  proximaNotificacao: number;
}

export interface ApoioDemo {
  hoje(): DataISO;
  /** Pessoas que podem ser escolhidas no seletor "Ver demonstracao como". */
  pessoasDemo(): { id: string; nome: string; papel: Papel; equipeId: string; equipe: string; funcao?: string }[];
  /** Papel real da pessoa (do cadastro) ou null se nao existe. */
  papelDe(pessoaId: string): Papel | null;
}

/* ------------------------------------------------------------------ seed */

function novoEstado(): Estado {
  const est: Estado = {
    equipes: EQUIPES.map((e) => ({ ...e })),
    pessoas: PESSOAS.map((p) => ({ ...p })),
    tipos: TIPOS.map((t) => ({ ...t })),
    pedidos: [],
    lancamentos: [],
    etapas: ETAPAS.map((e) => ({ ...e })),
    notificacoes: [],
    log: [],
    proximoPedido: 1,
    proximoLancamento: 1,
    proximaNotificacao: 1,
  };

  for (const p of est.pessoas) {
    credito(est, p.id, "ferias", 22, "Saldo anual de férias (ficção)", "2027-06-30");
    credito(est, p.id, "folga", 5, "Saldo anual de folgas (ficção)", "2027-06-30");
  }
  // Dias de férias que vencem em breve (alimentam "Férias vencendo").
  credito(est, "elisa", "ferias", 6, "Férias do período anterior (ficção)", "2027-01-15");
  credito(est, "felipe", "ferias", 4, "Férias do período anterior (ficção)", "2027-01-20");

  type Semente = {
    pessoaId: string;
    tipoId: string;
    inicio: DataISO;
    fim: DataISO;
    status: StatusPedido;
    criadoEm: InstanteISO;
    justificativa?: string;
    motivoPrivado?: string;
    motivoDecisao?: string;
    sugestao?: { inicio: DataISO; fim: DataISO };
    decididoPor?: string;
    sync?: "ok" | "falha";
  };
  const sementes: Semente[] = [
    { pessoaId: "ana", tipoId: "folga", inicio: "2026-09-14", fim: "2026-09-14", status: "aprovada", criadoEm: "2026-09-02T13:00:00.000Z", decididoPor: "carlos", sync: "ok" },
    {
      pessoaId: "ana", tipoId: "outro", inicio: "2026-08-27", fim: "2026-08-27", status: "recusada", criadoEm: "2026-08-20T13:00:00.000Z",
      motivoDecisao: "Entrega da sprint nessa semana. Pode remarcar para a seguinte?", decididoPor: "carlos",
      sugestao: { inicio: "2026-09-03", fim: "2026-09-03" },
    },
    { pessoaId: "bruno", tipoId: "ferias", inicio: "2026-11-16", fim: "2026-11-20", status: "aprovada", criadoEm: "2026-10-12T13:00:00.000Z", decididoPor: "carlos", sync: "ok" },
    { pessoaId: "diego", tipoId: "viagem", inicio: "2026-11-17", fim: "2026-11-19", status: "aprovada", criadoEm: "2026-10-14T13:00:00.000Z", decididoPor: "carlos", sync: "falha" },
    {
      pessoaId: "elisa", tipoId: "doenca", inicio: "2026-12-07", fim: "2026-12-09", status: "aprovada", criadoEm: "2026-10-20T13:00:00.000Z",
      motivoPrivado: "Procedimento agendado (texto fictício)", decididoPor: "carlos", sync: "ok",
    },
    { pessoaId: "ana", tipoId: "ferias", inicio: "2026-11-16", fim: "2026-11-27", status: "pendente", criadoEm: "2026-10-25T15:00:00.000Z" },
    { pessoaId: "camila", tipoId: "ferias", inicio: "2026-12-14", fim: "2026-12-23", status: "pendente", criadoEm: "2026-10-22T10:00:00.000Z" },
    { pessoaId: "carlos", tipoId: "ferias", inicio: "2027-02-15", fim: "2027-02-24", status: "pendente", criadoEm: "2026-10-24T12:00:00.000Z" },
    { pessoaId: "paula", tipoId: "ferias", inicio: "2026-12-21", fim: "2027-01-08", status: "pendente", criadoEm: "2026-10-23T12:00:00.000Z" },
    { pessoaId: "lucas", tipoId: "viagem", inicio: "2026-11-09", fim: "2026-11-11", status: "aprovada", criadoEm: "2026-10-15T12:00:00.000Z", decididoPor: "rafael", sync: "ok" },
    { pessoaId: "gabriel", tipoId: "ferias", inicio: "2026-11-23", fim: "2026-12-04", status: "pendente", criadoEm: "2026-10-26T09:00:00.000Z" },
    { pessoaId: "helena", tipoId: "ferias", inicio: "2026-11-23", fim: "2026-11-27", status: "aprovada", criadoEm: "2026-10-10T12:00:00.000Z", decididoPor: "vinicius", sync: "ok" },
    { pessoaId: "marina", tipoId: "outro", inicio: "2026-11-05", fim: "2026-11-06", status: "pendente", criadoEm: "2026-10-26T10:00:00.000Z" },
  ];

  const prazo = est.etapas.find((e) => e.chave === "com_gestor")?.prazoHoras;
  for (const s of sementes) {
    const tipo = est.tipos.find((t) => t.id === s.tipoId) as Tipo;
    const dias = diasUteisEntre(s.inicio, s.fim);
    const id = est.proximoPedido++;
    const aprovada = s.status === "aprovada";
    est.pedidos.push({
      id,
      pessoaId: s.pessoaId,
      tipoId: s.tipoId,
      inicio: s.inicio,
      fim: s.fim,
      diasUteis: dias.length,
      diasDebitoPorAno: tipo.consomeSaldo ? debitoPorAno(dias) : {},
      status: s.status,
      sincronizacao: aprovada ? (s.sync === "falha" ? "falha" : "ok") : "nao_aplicavel",
      justificativa: s.justificativa,
      motivoPrivado: s.motivoPrivado,
      excedeSaldo: false,
      motivoDecisao: s.motivoDecisao,
      sugestao: s.sugestao,
      prazoEm: s.status === "pendente" && prazo ? somarHoras(s.criadoEm, prazo) : undefined,
      criadoEm: s.criadoEm,
      decididoPor: s.decididoPor,
      decididoEm: s.decididoPor ? s.criadoEm : undefined,
      bitrixEventId: aprovada && s.sync === "ok" ? `demo-${id}` : undefined,
      versao: 1,
    });
    if (aprovada) {
      est.log.push({
        pedidoId: id,
        operacao: "adicionar",
        estado: s.sync === "falha" ? "falha" : "ok",
        tentativas: 1,
        quando: s.criadoEm,
        erro: s.sync === "falha" ? "Portal de demonstração indisponível (simulado)." : undefined,
      });
    }
  }

  const ana = est.pedidos.find((p) => p.pessoaId === "ana" && p.status === "pendente");
  if (ana) {
    notificar(est, "ana", ana.id, "com_gestor", textoEtapa(est, "com_gestor", ana), ana.criadoEm);
  }
  return est;
}

function credito(est: Estado, pessoaId: string, carteira: Carteira, dias: number, motivo: string, venceEm: DataISO): void {
  est.lancamentos.push({
    id: est.proximoLancamento++,
    pessoaId,
    ano: 2026,
    carteira,
    tipo: "credito",
    dias,
    motivo,
    venceEm,
    criadoPor: "marina",
    criadoEm: `${HOJE_DEMO}T08:00:00.000Z`,
  });
}

function somarHoras(instante: InstanteISO, horas: number): InstanteISO {
  return new Date(Date.parse(instante) + horas * 3_600_000).toISOString();
}

/* -------------------------------------------------------------- consultas */

function agora(): InstanteISO {
  return `${HOJE_DEMO}T${new Date().toISOString().slice(11)}`;
}

function achaPessoa(est: Estado, id: string): Pessoa {
  const p = est.pessoas.find((x) => x.id === id);
  if (!p) throw naoEncontrado();
  return p;
}

function visaoPessoa(p: Pessoa): PessoaVisao {
  return { id: p.id, nome: p.nome, equipeId: p.equipeId, papel: p.papel, funcao: p.funcao };
}

function achaTipo(est: Estado, id: string): Tipo {
  const t = est.tipos.find((x) => x.id === id);
  if (!t) throw naoEncontrado();
  return t;
}

function achaEquipe(est: Estado, id: string): Equipe {
  const e = est.equipes.find((x) => x.id === id);
  if (!e) throw naoEncontrado();
  return e;
}

function ativo(p: Pedido): boolean {
  return p.status === "pendente" || p.status === "aprovada";
}

/** Gestor da equipe da pessoa OU aprovador direto dela. */
function ehSuperiorDe(est: Estado, quem: SessaoDemo, alvo: Pessoa): boolean {
  if (quem.papel === "admin") return true;
  if (quem.papel !== "gestor") return false;
  const equipe = est.equipes.find((e) => e.id === alvo.equipeId);
  return equipe?.gestorId === quem.pessoaId || alvo.aprovadorId === quem.pessoaId;
}

function podeVer(est: Estado, p: Pedido, s: SessaoDemo): boolean {
  if (p.pessoaId === s.pessoaId) return true;
  return ehSuperiorDe(est, s, achaPessoa(est, p.pessoaId));
}

function podeDecidir(est: Estado, p: Pedido, s: SessaoDemo): boolean {
  return p.status === "pendente" && p.pessoaId !== s.pessoaId && ehSuperiorDe(est, s, achaPessoa(est, p.pessoaId));
}

function podeCancelar(est: Estado, p: Pedido, s: SessaoDemo): boolean {
  if (!ativo(p)) return false;
  if (p.pessoaId === s.pessoaId) return HOJE_DEMO < p.inicio;
  return ehSuperiorDe(est, s, achaPessoa(est, p.pessoaId));
}

function etapaDe(p: Pedido): ChaveEtapa {
  if (p.status === "pendente") return "com_gestor";
  if (p.status === "aprovada") return "confirmado";
  if (p.status === "recusada") return "recusado";
  return "enviado";
}

function visaoPedido(est: Estado, p: Pedido, s: SessaoDemo): PedidoVisao {
  const pessoa = achaPessoa(est, p.pessoaId);
  const tipo = achaTipo(est, p.tipoId);
  const dono = p.pessoaId === s.pessoaId;
  const admin = s.papel === "admin";
  const etapa = etapaDe(p);
  const aprovador = est.pessoas.find((x) => x.id === pessoa.aprovadorId);
  return {
    id: p.id,
    pessoa: visaoPessoa(pessoa),
    tipo: tipo.sensivel && !dono && !admin ? ROTULO_PUBLICO_SENSIVEL : tipo.nome,
    tipoSensivel: tipo.sensivel,
    inicio: p.inicio,
    fim: p.fim,
    diasUteis: p.diasUteis,
    status: p.status,
    sincronizacao: p.sincronizacao,
    etapa,
    etapaRotulo: p.status === "cancelada" ? "Cancelado" : (est.etapas.find((e) => e.chave === etapa)?.rotulo ?? etapa),
    excedeSaldo: p.excedeSaldo,
    justificativa: dono || admin || !tipo.sensivel ? p.justificativa : undefined,
    motivoPrivado: dono || admin ? p.motivoPrivado : undefined,
    motivoDecisao: p.motivoDecisao,
    sugestao: p.sugestao,
    prazoEm: p.prazoEm,
    criadoEm: p.criadoEm,
    versao: p.versao,
    aprovador: aprovador ? visaoPessoa(aprovador) : undefined,
    permitido: { cancelar: podeCancelar(est, p, s), decidir: podeDecidir(est, p, s) },
  };
}

function achaPedidoVisivel(est: Estado, id: number, s: SessaoDemo): Pedido {
  const p = est.pedidos.find((x) => x.id === id);
  if (!p || !podeVer(est, p, s)) throw naoEncontrado();
  return p;
}

function membros(est: Estado, equipeId: string): Pessoa[] {
  return est.pessoas.filter((p) => p.equipeId === equipeId);
}

/* ------------------------------------------------------------------ saldo */

function lancamentosValidos(est: Estado, pessoaId: string, carteira: Carteira, hoje: DataISO): Lancamento[] {
  return est.lancamentos
    .filter((l) => l.pessoaId === pessoaId && l.carteira === carteira && (!l.venceEm || l.venceEm >= hoje))
    .sort((a, b) => (a.venceEm ?? "9999-12-31").localeCompare(b.venceEm ?? "9999-12-31"));
}

function debitoAtivo(est: Estado, pessoaId: string, carteira: Carteira, ignorarPedidoId?: number): number {
  let total = 0;
  for (const p of est.pedidos) {
    if (p.pessoaId !== pessoaId || !ativo(p) || p.id === ignorarPedidoId) continue;
    if (achaTipo(est, p.tipoId).consomeSaldo === carteira) total += p.diasUteis;
  }
  return total;
}

function disponivel(est: Estado, pessoaId: string, carteira: Carteira, ignorarPedidoId?: number): number {
  const creditos = lancamentosValidos(est, pessoaId, carteira, HOJE_DEMO).reduce((a, l) => a + l.dias, 0);
  return creditos - debitoAtivo(est, pessoaId, carteira, ignorarPedidoId);
}

function saldoVisao(est: Estado, pessoaId: string, carteira: Carteira): SaldoVisao {
  let debito = debitoAtivo(est, pessoaId, carteira);
  let vencendo: SaldoVisao["vencendo"] = null;
  for (const l of lancamentosValidos(est, pessoaId, carteira, HOJE_DEMO)) {
    const consumido = Math.min(debito, l.dias);
    debito -= consumido;
    const resta = l.dias - consumido;
    if (!vencendo && resta > 0 && l.venceEm && diferencaDias(HOJE_DEMO, l.venceEm) <= 90) {
      vencendo = { dias: resta, venceEm: l.venceEm };
    }
  }
  return { carteira, disponivel: disponivel(est, pessoaId, carteira), vencendo };
}

/* -------------------------------------------------------------- cobertura */

interface OpcoesCobertura {
  incluirPendentes: boolean;
  /** Pedidos desconsiderados (o que esta sendo avaliado). */
  ignorarPedidos?: number[];
  /** Pessoas cujos pedidos nao contam (cobertura "como se estivessem presentes"). */
  ignorarPessoas?: string[];
}

function ausentesNoDia(est: Estado, equipeId: string, dia: DataISO, op: OpcoesCobertura): number {
  const ids = new Set(membros(est, equipeId).map((m) => m.id));
  const quem = new Set<string>();
  for (const p of est.pedidos) {
    if (!ids.has(p.pessoaId)) continue;
    if (op.ignorarPedidos?.includes(p.id) || op.ignorarPessoas?.includes(p.pessoaId)) continue;
    const conta = p.status === "aprovada" || (op.incluirPendentes && p.status === "pendente");
    if (conta && p.inicio <= dia && dia <= p.fim) quem.add(p.pessoaId);
  }
  return quem.size;
}

function trabalhandoNoDia(est: Estado, equipeId: string, dia: DataISO, op: OpcoesCobertura): number {
  return membros(est, equipeId).length - ausentesNoDia(est, equipeId, dia, op);
}

function diasDoCalendario(est: Estado, equipe: Equipe, de: DataISO, ate: DataISO): DiaCalendarioVisao[] {
  return intervalo(de, ate).map((data) => {
    const util = ehUtil(data);
    const trabalhando = trabalhandoNoDia(est, equipe.id, data, { incluirPendentes: equipe.contarPendentes });
    return { data, util, feriado: ehFeriado(data), trabalhando, abaixoDoMinimo: util && trabalhando < equipe.minimoPessoas };
  });
}

/** Ate 3 janelas de `n` dias uteis seguidos (180 dias) em que a equipe segue >= minimo. */
function melhorJanela(
  est: Estado,
  equipe: Equipe,
  n: number,
  pessoaId: string,
  ignorarPedidoId?: number,
): { inicio: DataISO; fim: DataISO; minimo: number }[] {
  if (n < 1) return [];
  const proprios = est.pedidos.filter((p) => p.pessoaId === pessoaId && ativo(p) && p.id !== ignorarPedidoId);
  const uteis = diasUteisEntre(somarDias(HOJE_DEMO, 1), somarDias(HOJE_DEMO, 180));
  const op: OpcoesCobertura = { incluirPendentes: equipe.contarPendentes, ignorarPessoas: [pessoaId] };
  const trab = uteis.map((d) => trabalhandoNoDia(est, equipe.id, d, op) - 1);
  const candidatas: { inicio: DataISO; fim: DataISO; minimo: number }[] = [];
  for (let i = 0; i + n <= uteis.length; i++) {
    const inicio = uteis[i];
    const fim = uteis[i + n - 1];
    if (proprios.some((p) => sobrepoe(p, { inicio, fim }))) continue;
    const minimo = Math.min(...trab.slice(i, i + n));
    if (minimo >= equipe.minimoPessoas) candidatas.push({ inicio, fim, minimo });
  }
  candidatas.sort((a, b) => b.minimo - a.minimo || a.inicio.localeCompare(b.inicio));
  const escolhidas: { inicio: DataISO; fim: DataISO; minimo: number }[] = [];
  for (const c of candidatas) {
    if (escolhidas.length >= 3) break;
    if (!escolhidas.some((e) => sobrepoe(e, c))) escolhidas.push(c);
  }
  return escolhidas;
}

/* ------------------------------------------------------------ notificacoes */

function renderizar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{([^}]*)\}/g, (_m, k: string) => vars[k] ?? "");
}

function textoEtapa(est: Estado, chave: ChaveEtapa, p: Pedido): string {
  const etapa = est.etapas.find((e) => e.chave === chave);
  const tipo = achaTipo(est, p.tipoId);
  const pessoa = achaPessoa(est, p.pessoaId);
  return renderizar(etapa?.mensagem ?? "", {
    nome: pessoa.nome,
    periodo: periodoCurto(p.inicio, p.fim),
    tipoPublico: tipo.sensivel ? ROTULO_PUBLICO_SENSIVEL : tipo.nome,
    prazo: p.prazoEm ? `${curto(p.prazoEm.slice(0, 10))} às ${p.prazoEm.slice(11, 16)}` : "sem prazo",
  });
}

/** Uma notificacao por (pessoa, pedido, etapa): repetir nao duplica. */
function notificar(est: Estado, pessoaId: string, pedidoId: number, etapa: string, texto: string, quando: InstanteISO): void {
  if (est.notificacoes.some((n) => n.pessoaId === pessoaId && n.pedidoId === pedidoId && n.etapa === etapa)) return;
  est.notificacoes.push({ id: est.proximaNotificacao++, pessoaId, pedidoId, etapa, texto, criadaEm: quando, lida: false });
}

/* ------------------------------------------------------------ sincronizacao */

/** Bitrix FAKE: sempre confirma (salvo as sementes marcadas com falha). */
function sincronizarAdicao(est: Estado, p: Pedido): void {
  p.sincronizacao = "ok";
  p.bitrixEventId = `demo-${p.id}`;
  est.log.push({ pedidoId: p.id, operacao: "adicionar", estado: "ok", tentativas: 1, quando: agora() });
}

function sincronizarRemocao(est: Estado, p: Pedido, tinhaEvento: boolean): void {
  if (!tinhaEvento) {
    p.sincronizacao = "nao_aplicavel";
    return;
  }
  p.sincronizacao = "removido";
  p.bitrixEventId = undefined;
  est.log.push({ pedidoId: p.id, operacao: "remover", estado: "removido", tentativas: 1, quando: agora() });
}

/* ---------------------------------------------------------------- servicos */

function exigirAdmin(s: SessaoDemo): void {
  if (s.papel !== "admin") throw semPermissao();
}

function equipesVisiveis(est: Estado, s: SessaoDemo): Equipe[] {
  if (s.papel === "admin") return est.equipes;
  const eu = achaPessoa(est, s.pessoaId);
  if (s.papel === "gestor") return est.equipes.filter((e) => e.gestorId === s.pessoaId || e.id === eu.equipeId);
  return est.equipes.filter((e) => e.id === eu.equipeId);
}

/** Equipe que a sessao pode OLHAR em calendario/disponibilidade (gestor e admin). */
function equipeGerenciada(est: Estado, s: SessaoDemo, equipeId: string): Equipe {
  if (s.papel === "colaborador") throw semPermissao();
  const equipe = achaEquipe(est, equipeId);
  if (s.papel === "admin") return equipe;
  const eu = achaPessoa(est, s.pessoaId);
  if (equipe.gestorId !== s.pessoaId && equipe.id !== eu.equipeId) throw semPermissao();
  return equipe;
}

function validarJanela(de: DataISO, ate: DataISO): void {
  if (de > ate) throw erroCampo("ate", "A data final vem antes da inicial.");
  if (diferencaDias(de, ate) > 92) throw erroCampo("ate", "Escolha no máximo três meses por vez.");
}

function calcularPrevia(est: Estado, s: SessaoDemo, e: EntradaCriarPedido): { previa: PreviaPedido; tipo: Tipo; pessoa: Pessoa } {
  const tipo = est.tipos.find((t) => t.id === e.tipoId);
  if (!tipo) throw erroCampo("tipoId", "Escolha um tipo de ausência da lista.");
  if (tipo.quemPede === "admin" && s.papel !== "admin") throw semPermissao("Este tipo é lançado pelo administrador.");
  const pessoa = achaPessoa(est, s.pessoaId);
  const equipe = achaEquipe(est, pessoa.equipeId);
  const dias = diasUteisEntre(e.inicio, e.fim);
  const atual = tipo.consomeSaldo ? disponivel(est, pessoa.id, tipo.consomeSaldo) : 0;
  const aprovador = achaPessoa(est, pessoa.aprovadorId);

  const op: OpcoesCobertura = { incluirPendentes: equipe.contarPendentes, ignorarPessoas: [pessoa.id] };
  const conflitoEquipe = dias.some((d) => trabalhandoNoDia(est, equipe.id, d, op) - 1 < equipe.minimoPessoas);

  const previa: PreviaPedido = {
    diasUteis: dias.length,
    diasDebitoPorAno: tipo.consomeSaldo ? debitoPorAno(dias) : {},
    excedeSaldo: tipo.consomeSaldo ? dias.length > atual : false,
    saldoDepois: tipo.consomeSaldo ? atual - dias.length : 0,
    aprovador: visaoPessoa(aprovador),
    conflitoEquipe,
    datasLivres: melhorJanela(est, equipe, dias.length, pessoa.id).map((j) => ({ inicio: j.inicio, fim: j.fim })),
  };
  return { previa, tipo, pessoa };
}

function criarServicos(est: Estado): ServicosAusencias {
  return {
    eu(s) {
      return visaoPessoa(achaPessoa(est, s.pessoaId));
    },

    tiposPediveis(s) {
      return est.tipos.filter((t) => t.quemPede === "todos" || s.papel === "admin").map((t) => ({ ...t }));
    },

    previa(s, e) {
      return calcularPrevia(est, s, e).previa;
    },

    async solicitar(s, e) {
      const { previa, tipo, pessoa } = calcularPrevia(est, s, e);
      if (previa.diasUteis < 1) throw erroCampo("fim", "O período escolhido não tem dias úteis.");
      if (tipo.sensivel && e.justificativa) {
        throw erroCampo("justificativa", "Este tipo não aceita justificativa aberta. Use o campo de motivo privado.");
      }
      if (!tipo.sensivel && e.motivoPrivado) throw erroCampo("motivoPrivado", "Este tipo não usa motivo privado.");
      if (!tipo.sensivel && previa.excedeSaldo && !e.justificativa) {
        throw erroCampo("justificativa", "Seu saldo não cobre o período. Explique por que você precisa desses dias.");
      }
      const dias = new Set(diasUteisEntre(e.inicio, e.fim));
      const choque = est.pedidos.find(
        (p) => p.pessoaId === pessoa.id && ativo(p) && diasUteisEntre(p.inicio, p.fim).some((d) => dias.has(d)),
      );
      if (choque) {
        throw conflito(`Você já tem um pedido nesses dias (${periodoCurto(choque.inicio, choque.fim)}). Escolha outras datas.`);
      }
      const criadoEm = agora();
      const prazo = est.etapas.find((x) => x.chave === "com_gestor")?.prazoHoras;
      const pedido: Pedido = {
        id: est.proximoPedido++,
        pessoaId: pessoa.id,
        tipoId: tipo.id,
        inicio: e.inicio,
        fim: e.fim,
        diasUteis: previa.diasUteis,
        diasDebitoPorAno: previa.diasDebitoPorAno,
        status: "pendente",
        sincronizacao: "nao_aplicavel",
        justificativa: tipo.sensivel ? undefined : e.justificativa,
        motivoPrivado: tipo.sensivel ? e.motivoPrivado : undefined,
        excedeSaldo: previa.excedeSaldo,
        prazoEm: prazo ? somarHoras(criadoEm, prazo) : undefined,
        criadoEm,
        versao: 1,
      };
      est.pedidos.push(pedido);
      notificar(est, pessoa.id, pedido.id, "com_gestor", textoEtapa(est, "com_gestor", pedido), criadoEm);
      notificar(
        est,
        pessoa.aprovadorId,
        pedido.id,
        "novo",
        `${pessoa.nome} pediu ${tipo.sensivel ? ROTULO_PUBLICO_SENSIVEL : tipo.nome} (${periodoCurto(pedido.inicio, pedido.fim)}).`,
        criadoEm,
      );
      return visaoPedido(est, pedido, s);
    },

    async decidir(s, pedidoId, e: EntradaDecidir) {
      const p = est.pedidos.find((x) => x.id === pedidoId);
      if (!p || !podeVer(est, p, s) || !podeDecidir(est, p, s)) throw naoEncontrado();
      if (e.versao !== p.versao) {
        throw conflito("Este pedido mudou enquanto você olhava. Atualize a tela e confira de novo.");
      }
      const quando = agora();
      if (e.decisao === "aprovar") {
        const recalculado = diasUteisEntre(p.inicio, p.fim).length;
        if (recalculado !== p.diasUteis && !e.confirmarRecalculo) {
          throw conflito(`Os dias úteis mudaram de ${p.diasUteis} para ${recalculado}. Confirme o recálculo para aprovar.`);
        }
        const tipo = achaTipo(est, p.tipoId);
        p.diasUteis = recalculado;
        p.diasDebitoPorAno = tipo.consomeSaldo ? debitoPorAno(diasUteisEntre(p.inicio, p.fim)) : {};
        p.excedeSaldo = tipo.consomeSaldo ? recalculado > disponivel(est, p.pessoaId, tipo.consomeSaldo, p.id) : false;
        p.status = "aprovada";
        p.motivoDecisao = e.motivoDecisao;
      } else {
        p.status = "recusada";
        p.motivoDecisao = e.motivoDecisao;
        p.sugestao = e.sugestao;
      }
      p.decididoPor = s.pessoaId;
      p.decididoEm = quando;
      p.prazoEm = undefined;
      p.versao += 1;
      if (p.status === "aprovada") sincronizarAdicao(est, p);
      const etapa: ChaveEtapa = p.status === "aprovada" ? "confirmado" : "recusado";
      notificar(est, p.pessoaId, p.id, etapa, textoEtapa(est, etapa, p), quando);
      return visaoPedido(est, p, s);
    },

    async cancelar(s, pedidoId) {
      const p = est.pedidos.find((x) => x.id === pedidoId);
      if (!p || !podeVer(est, p, s) || !podeCancelar(est, p, s)) throw naoEncontrado();
      const tinhaEvento = p.status === "aprovada" && Boolean(p.bitrixEventId);
      p.status = "cancelada";
      p.canceladoEm = HOJE_DEMO;
      p.canceladoPor = s.pessoaId;
      p.prazoEm = undefined;
      p.versao += 1;
      sincronizarRemocao(est, p, tinhaEvento);
      return visaoPedido(est, p, s);
    },

    meusPedidos(s) {
      return est.pedidos
        .filter((p) => p.pessoaId === s.pessoaId)
        .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm) || b.id - a.id)
        .map((p) => visaoPedido(est, p, s));
    },

    paraAprovar(s) {
      return est.pedidos
        .filter((p) => podeDecidir(est, p, s))
        .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.id - b.id)
        .map((p) => visaoPedido(est, p, s));
    },

    pedido(s, pedidoId) {
      return visaoPedido(est, achaPedidoVisivel(est, pedidoId, s), s);
    },

    impacto(s, pedidoId): ImpactoPedidoVisao {
      const p = achaPedidoVisivel(est, pedidoId, s);
      if (s.papel === "colaborador") throw naoEncontrado();
      const pessoa = achaPessoa(est, p.pessoaId);
      const equipe = achaEquipe(est, pessoa.equipeId);
      const tipo = achaTipo(est, p.tipoId);
      const op: OpcoesCobertura = { incluirPendentes: equipe.contarPendentes, ignorarPedidos: [p.id] };

      const semanas: SemanaPiorDiaVisao[] = [];
      for (let seg = segundaDaSemana(p.inicio); seg <= p.fim; seg = somarDias(seg, 7)) {
        const uteis = diasUteisEntre(seg, somarDias(seg, 6));
        if (uteis.length === 0) continue;
        const sem = uteis.map((d) => trabalhandoNoDia(est, equipe.id, d, op));
        const com = uteis.map((d, i) => sem[i] - (p.inicio <= d && d <= p.fim ? 1 : 0));
        semanas.push({ semanaInicio: seg, semPedido: Math.min(...sem), comPedido: Math.min(...com) });
      }

      const idsEquipe = new Set(membros(est, equipe.id).map((m) => m.id));
      const tambemFora = est.pedidos
        .filter((x) => x.id !== p.id && x.pessoaId !== p.pessoaId && idsEquipe.has(x.pessoaId) && ativo(x) && sobrepoe(x, p))
        .map((x) => ({ pessoa: visaoPessoa(achaPessoa(est, x.pessoaId)), inicio: x.inicio, fim: x.fim }));

      const consome = tipo.consomeSaldo;
      // Pedido ativo ja esta debitado no saldo atual: "antes" devolve esses dias.
      const atual = consome ? disponivel(est, p.pessoaId, consome) : 0;
      const antes = consome && ativo(p) ? atual + p.diasUteis : atual;
      const depois = atual;

      const umAnoAtras = somarDias(HOJE_DEMO, -365);
      let fora12 = 0;
      for (const x of est.pedidos) {
        if (x.pessoaId !== p.pessoaId || x.status !== "aprovada" || x.id === p.id || achaTipo(est, x.tipoId).sensivel) continue;
        fora12 += diasUteisEntre(x.inicio < umAnoAtras ? umAnoAtras : x.inicio, x.fim > HOJE_DEMO ? HOJE_DEMO : x.fim).length;
      }

      return {
        pedidoId: p.id,
        semanas,
        tambemForaNoPeriodo: tambemFora,
        saldoAntes: antes,
        saldoDepois: depois,
        foraUltimos12Meses: fora12,
        alternativas: melhorJanela(est, equipe, p.diasUteis, p.pessoaId, p.id).map((j) => ({
          inicio: j.inicio,
          fim: j.fim,
          motivo: `Equipe com ${j.minimo} pessoas trabalhando (mínimo ${equipe.minimoPessoas}).`,
        })),
      };
    },

    saldos(s) {
      return (["ferias", "folga"] as Carteira[]).map((c) => saldoVisao(est, s.pessoaId, c));
    },

    creditar(s, e: EntradaCreditar) {
      if (s.papel === "colaborador") throw semPermissao();
      const alvo = est.pessoas.find((x) => x.id === e.pessoaId);
      if (!alvo) throw erroCampo("pessoaId", "Escolha uma pessoa da lista.");
      if (alvo.id === s.pessoaId) throw semPermissao("Ninguém credita dias para si mesmo.");
      if (!ehSuperiorDe(est, s, alvo)) throw semPermissao();
      est.lancamentos.push({
        id: est.proximoLancamento++,
        pessoaId: alvo.id,
        ano: Number(HOJE_DEMO.slice(0, 4)),
        carteira: e.carteira,
        tipo: "credito",
        dias: e.dias,
        motivo: e.motivo,
        venceEm: e.venceEm,
        criadoPor: s.pessoaId,
        criadoEm: agora(),
      });
    },

    calendario(s, equipeId, de, ate): CalendarioVisao {
      const equipe = equipeGerenciada(est, s, equipeId);
      validarJanela(de, ate);
      const pessoas = membros(est, equipe.id);
      const ids = new Set(pessoas.map((m) => m.id));
      const ausencias: AusenciaCalendarioVisao[] = est.pedidos
        .filter((p) => ids.has(p.pessoaId) && ativo(p) && sobrepoe(p, { inicio: de, fim: ate }))
        .map((p) => {
          const tipo = achaTipo(est, p.tipoId);
          return {
            pedidoId: p.id,
            pessoaId: p.pessoaId,
            inicio: p.inicio,
            fim: p.fim,
            rotulo: tipo.sensivel ? ROTULO_PUBLICO_SENSIVEL : tipo.nome,
            cor: tipo.sensivel ? COR_NEUTRA : tipo.cor,
            pendente: p.status === "pendente",
          };
        });
      return { equipeId: equipe.id, de, ate, pessoas: pessoas.map(visaoPessoa), ausencias, dias: diasDoCalendario(est, equipe, de, ate) };
    },

    disponibilidade(s, equipeId, de, ate): DisponibilidadeVisao {
      const equipe = equipeGerenciada(est, s, equipeId);
      validarJanela(de, ate);
      const dias = diasDoCalendario(est, equipe, de, ate);
      const uteis = dias.filter((d) => d.util);
      let pior: DisponibilidadeVisao["piorDia"] = null;
      for (const d of uteis) if (!pior || d.trabalhando < pior.trabalhando) pior = { data: d.data, trabalhando: d.trabalhando };

      // "Atencao": pedidos ativos que levam a equipe abaixo do minimo (pendente = "se aprovar").
      const piorCaso: OpcoesCobertura = { incluirPendentes: true };
      const ids = new Set(membros(est, equipe.id).map((m) => m.id));
      const atencao: DisponibilidadeVisao["atencao"] = [];
      for (const p of est.pedidos) {
        if (!ids.has(p.pessoaId) || !ativo(p) || !sobrepoe(p, { inicio: de, fim: ate })) continue;
        const dd = diasUteisEntre(p.inicio < de ? de : p.inicio, p.fim > ate ? ate : p.fim);
        const abaixo = dd.map((d) => trabalhandoNoDia(est, equipe.id, d, piorCaso)).filter((n) => n < equipe.minimoPessoas);
        if (abaixo.length === 0) continue;
        const nome = achaPessoa(est, p.pessoaId).nome;
        atencao.push({
          pedidoId: p.id,
          texto: `${nome} (${periodoCurto(p.inicio, p.fim)}): ${abaixo.length} dia(s) abaixo do mínimo, com ${Math.min(...abaixo)} de ${ids.size} trabalhando${
            p.status === "pendente" ? " se aprovar" : ""
          }.`,
        });
      }
      return {
        equipeId: equipe.id,
        minimoPessoas: equipe.minimoPessoas,
        contarPendentes: equipe.contarPendentes,
        totalMembros: ids.size,
        dias,
        diasAbaixoDoMinimo: uteis.filter((d) => d.abaixoDoMinimo).length,
        piorDia: pior,
        atencao,
      };
    },

    painel(s, equipeId): PainelVisao {
      if (s.papel === "colaborador") throw semPermissao();
      let escopoEquipes: Equipe[];
      if (equipeId) escopoEquipes = [equipeGerenciada(est, s, equipeId)];
      else if (s.papel === "admin") escopoEquipes = est.equipes;
      else escopoEquipes = equipesVisiveis(est, s).filter((e) => e.gestorId === s.pessoaId);
      const idsEquipes = new Set(escopoEquipes.map((e) => e.id));
      const gente = est.pessoas.filter((p) => idsEquipes.has(p.equipeId));
      const idsGente = new Set(gente.map((p) => p.id));
      const pedidos = est.pedidos.filter((p) => idsGente.has(p.pessoaId));
      const instante = agora();

      const porStatus: Record<StatusPedido, number> = { pendente: 0, aprovada: 0, recusada: 0, cancelada: 0 };
      for (const p of pedidos) porStatus[p.status] += 1;
      const pendentes = pedidos.filter((p) => p.status === "pendente");

      const horizonte = somarDias(HOJE_DEMO, 90);
      const porTipo = new Map<string, { dias: number; pessoas: Set<string> }>();
      for (const p of pedidos) {
        if (p.status !== "aprovada" || !sobrepoe(p, { inicio: HOJE_DEMO, fim: horizonte })) continue;
        const tipo = achaTipo(est, p.tipoId);
        const rotulo = tipo.sensivel ? ROTULO_PLURAL_SENSIVEL : tipo.nome;
        const acc = porTipo.get(rotulo) ?? { dias: 0, pessoas: new Set<string>() };
        acc.dias += diasUteisEntre(p.inicio < HOJE_DEMO ? HOJE_DEMO : p.inicio, p.fim > horizonte ? horizonte : p.fim).length;
        acc.pessoas.add(p.pessoaId);
        porTipo.set(rotulo, acc);
      }
      const diasPorTipo = [...porTipo.entries()]
        // Agregado sensivel com menos de 3 pessoas identificaria quem esta de licenca.
        .filter(([rotulo, v]) => rotulo !== ROTULO_PLURAL_SENSIVEL || v.pessoas.size >= 3)
        .map(([rotulo, v]) => ({ rotulo, dias: v.dias }))
        .sort((a, b) => b.dias - a.dias);

      const feriasVencendo: PainelVisao["feriasVencendo"] = [];
      for (const pessoa of gente) {
        const v = saldoVisao(est, pessoa.id, "ferias").vencendo;
        if (v) feriasVencendo.push({ pessoa: visaoPessoa(pessoa), dias: v.dias, venceEm: v.venceEm });
      }
      feriasVencendo.sort((a, b) => a.venceEm.localeCompare(b.venceEm));

      const decididas = pedidos.filter((p) => p.decididoEm);
      const aprovadas = decididas.filter((p) => p.status === "aprovada" || (p.status === "cancelada" && p.decididoPor)).length;
      const recusadas = decididas.filter((p) => p.status === "recusada").length;
      const tempos = decididas.map((p) => (Date.parse(p.decididoEm as string) - Date.parse(p.criadoEm)) / 3_600_000);

      return {
        escopo: s.papel === "admin" && !equipeId ? "empresa" : "equipe",
        porStatus,
        aguardandoGestor: {
          total: pendentes.length,
          atrasados: pendentes.filter((p) => p.prazoEm && p.prazoEm < instante).length,
        },
        diasPorTipo,
        feriasVencendo,
        diasAbaixoDoMinimoPorEquipe: escopoEquipes.map((eq) => ({
          equipeId: eq.id,
          nome: eq.nome,
          dias: diasDoCalendario(est, eq, HOJE_DEMO, horizonte).filter((d) => d.abaixoDoMinimo).length,
        })),
        // Fracao de 0 a 1 (a tela formata como porcentagem).
        taxaAprovacao: aprovadas + recusadas > 0 ? aprovadas / (aprovadas + recusadas) : null,
        tempoMedioDecisaoHoras: tempos.length ? Math.round((tempos.reduce((a, b) => a + b, 0) / tempos.length) * 10) / 10 : null,
      };
    },

    notificacoes(s) {
      return est.notificacoes
        .filter((n) => n.pessoaId === s.pessoaId)
        .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm) || b.id - a.id)
        .map((n) => ({ id: n.id, pedidoId: n.pedidoId, etapa: n.etapa, texto: n.texto, criadaEm: n.criadaEm, lida: n.lida }));
    },

    lembrarGestor(s, pedidoId) {
      // Rota [id]: negado = 404 (nao revela se o pedido existe).
      if (s.papel !== "admin") throw naoEncontrado();
      const p = achaPedidoVisivel(est, pedidoId, s);
      if (p.status !== "pendente") throw conflito("Este pedido já foi decidido.");
      const pessoa = achaPessoa(est, p.pessoaId);
      // No maximo 1 lembrete por dia e pedido (idempotente).
      notificar(
        est,
        pessoa.aprovadorId,
        p.id,
        `lembrete:${HOJE_DEMO}`,
        `Lembrete: o pedido de ${pessoa.nome} (${periodoCurto(p.inicio, p.fim)}) aguarda sua resposta.`,
        agora(),
      );
    },

    etapas() {
      return est.etapas.map((e) => ({ ...e }));
    },

    editarEtapa(s, e: EntradaEtapa) {
      exigirAdmin(s);
      const atual = est.etapas.find((x) => x.chave === e.chave);
      if (!atual) throw naoEncontrado();
      atual.rotulo = e.rotulo;
      atual.mensagem = e.mensagem;
      // Prazo so existe na etapa com_gestor.
      atual.prazoHoras = e.chave === "com_gestor" ? e.prazoHoras : undefined;
      return est.etapas.map((x) => ({ ...x }));
    },

    equipes(s) {
      return equipesVisiveis(est, s).map((e) => ({ ...e }));
    },

    definirMinimo(s, equipeId, e: EntradaMinimo) {
      const equipe = equipeGerenciada(est, s, equipeId);
      if (s.papel === "gestor" && equipe.gestorId !== s.pessoaId) throw semPermissao();
      equipe.minimoPessoas = e.minimoPessoas;
      equipe.contarPendentes = e.contarPendentes;
      return { ...equipe };
    },

    logSincronizacao(s) {
      exigirAdmin(s);
      return [...est.log].sort((a, b) => b.quando.localeCompare(a.quando)).map((l) => ({ ...l }));
    },

    async reprocessarSincronizacao(s, pedidoId) {
      exigirAdmin(s);
      let alvo = est.pedidos.filter((p) => p.status === "aprovada" && (p.sincronizacao === "falha" || p.sincronizacao === "falha_manual"));
      if (pedidoId !== undefined) {
        const p = est.pedidos.find((x) => x.id === pedidoId);
        if (!p) throw naoEncontrado();
        alvo = alvo.filter((x) => x.id === p.id);
      }
      for (const p of alvo) sincronizarAdicao(est, p);
    },
  };
}

/* ------------------------------------------------------------- singleton */

interface Global {
  __revezzaDemoEstado?: Estado;
  __revezzaDemoServicos?: ServicosAusencias;
}

function g(): Global {
  return globalThis as unknown as Global;
}

/** Estado e servicos ficam em `globalThis`: o Next pode carregar este modulo mais de uma vez. */
export function obterServicos(): ServicosAusencias {
  const glob = g();
  if (!glob.__revezzaDemoServicos) {
    glob.__revezzaDemoEstado = novoEstado();
    glob.__revezzaDemoServicos = criarServicos(glob.__revezzaDemoEstado);
  }
  return glob.__revezzaDemoServicos;
}

/** Volta ao seed inicial (testes). */
export function reiniciarDemo(): void {
  const glob = g();
  glob.__revezzaDemoEstado = undefined;
  glob.__revezzaDemoServicos = undefined;
}

export function obterApoioDemo(): ApoioDemo {
  return {
    hoje: () => HOJE_DEMO,
    pessoasDemo: () =>
      PESSOAS.map((p) => ({
        id: p.id,
        nome: p.nome,
        papel: p.papel,
        equipeId: p.equipeId,
        equipe: EQUIPES.find((e) => e.id === p.equipeId)?.nome ?? p.equipeId,
        funcao: p.funcao,
      })),
    papelDe: (pessoaId) => PESSOAS.find((p) => p.id === pessoaId)?.papel ?? null,
  };
}
