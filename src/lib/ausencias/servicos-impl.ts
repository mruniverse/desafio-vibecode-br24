/**
 * Implementacao real de `ServicosAusencias` (BR24-005 v2.2): dominio puro (C1)
 * + repositorios SQLite (C2) + porta/executor Bitrix (C3).
 *
 * Regras que atravessam tudo:
 *  - a SESSAO traz so a pessoa; o papel e RELIDO do banco (`resolverSessao`);
 *  - negado em recurso por id = 404 sem efeito colateral; rota sem id = 403;
 *  - TODO DTO de pedido sai por `paraVisao` (visao.ts);
 *  - gravacoes compostas em `emTransacao` (.immediate(), sem await dentro);
 *    a porta Bitrix so e chamada DEPOIS da transacao (sincronizacao inline);
 *  - motivoPrivado/justificativa/motivoDecisao nunca vao para notificacao,
 *    auditoria, log nem evento do Bitrix;
 *  - dias uteis e debito por ano sao calculados NO SERVIDOR com o calendario do
 *    portal (cache; falha da porta => fallback SA,SU).
 *
 * Sem enum/namespace/propriedade de parametro (strip-types dos testes).
 */
import { escaparBBCode } from "@/lib/bitrix/ausencias/util";
import type { OpcoesExecutor } from "@/lib/bitrix/ausencias/executor";
import { logger } from "@/lib/logger";
import {
  podeCancelar,
  podeCreditar,
  podeDecidir,
  podeEditarMinimo,
  podeVer,
  podeVerEquipe,
  podeVerImpacto,
  gerenciaEquipe,
  ehAdmin,
} from "./autorizacao";
import {
  contarDiasAbaixoDoMinimo,
  haConflitoDeEquipe,
  intervaloQueConta,
  membrosDaEquipe,
  piorDia,
  piorDiaPorSemana,
  pessoasTrabalhandoPorDia,
  verificarSobreposicao,
} from "./cobertura";
import type { PedidoCobertura } from "./cobertura";
import { diasEntre, somarDias, somarHoras } from "./datas";
import { calendarioDoPortal, diasUteisEntre } from "./dias-uteis";
import type { CalendarioUtil } from "./dias-uteis";
import { ErroDominio } from "./erros";
import { conflito, erroCampo, negadoComoInexistente, semPermissao } from "./erros-servico";
import { intervaloVigente } from "./estados";
import { indicadores } from "./indicadores";
import { melhorJanela } from "./janela";
import { periodoCurto, rotuloPublicoDoTipo, textoDaEtapa } from "./mensagens";
import type { PortaBitrix } from "./portas";
import {
  criarLancamento,
  criarPedido,
  decidirPedido,
  cancelarPedido,
  definirMinimoEquipe,
  emTransacao,
  gravarNotificacao,
  lancamentosDaEquipe,
  lancamentosDaPessoa,
  lerPedidoInterno,
  listarDebitosDaPessoa,
  listarEquipes,
  listarEtapas,
  listarLogSincronizacao,
  listarNotificacoes,
  listarPedidosDaPessoa,
  listarPedidosParaAprovar,
  listarPedidosVisiveis,
  listarPessoas,
  listarTipos,
  obterEquipe,
  obterPessoa,
  registrarAuditoria,
  reprocessarJobs,
  salvarEtapa,
} from "./repo";
import type { DecisaoPedido } from "./repo";
import { diasDebitoPorAno as calcularDebitoPorAno, saldo as calcularSaldo, simularPedido } from "./saldo";
import {
  creditarSchema,
  criarPedidoSchema,
  decidirPedidoSchema,
  etapaSchema,
  minimoEquipeSchema,
} from "./schemas";
import { resolverSessao } from "./sessao";
import type { SessaoResolvida } from "./sessao";
import type {
  EntradaCreditar,
  EntradaCriarPedido,
  EntradaDecidir,
  EntradaEtapa,
  EntradaMinimo,
  PreviaPedido,
  ServicosAusencias,
} from "./servicos";
import { processarFilaSincronizacao } from "./servicos-sync";
import { ROTULO_PUBLICO_SENSIVEL } from "./tipos";
import type {
  Carteira,
  DataISO,
  Equipe,
  Etapa,
  Pedido,
  Pessoa,
  Relogio,
  SessaoDemo,
  Tipo,
} from "./tipos";
import { paraVisao, paraVisaoPessoa } from "./visao";
import type { DadosVisao } from "./visao";
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
  SincronizacaoLogVisao,
} from "./visoes";

/** Cor neutra do calendario para tipo sensivel (a cor do tipo revelaria a licenca). */
const COR_NEUTRA = "#94A3B8";
/** Janela maxima de calendario/disponibilidade (dias). */
const JANELA_MAX_DIAS = 92;
const TTL_CALENDARIO_MS = 10 * 60 * 1000;
const TTL_FALLBACK_MS = 60 * 1000;

export interface DepsServicos {
  portalMemberId: string;
  relogio: Relogio;
  porta: PortaBitrix;
  opcoesExecutor?: OpcoesExecutor;
}

export interface ServicosAusenciasImpl extends ServicosAusencias {
  /** Carrega (ou renova) o calendario de trabalho do portal. */
  aquecerCalendario(): Promise<void>;
  /** Roda a fila de sincronizacao agora (inline). */
  processarSincronizacao(): Promise<number>;
}

interface CacheCalendario {
  cal: CalendarioUtil;
  ate: number;
}

type DestinoBitrix = { pessoaId: string; texto: string };

export function criarServicosAusencias(deps: DepsServicos): ServicosAusenciasImpl {
  const m = deps.portalMemberId;
  const { relogio, porta } = deps;

  let cache: CacheCalendario | null = null;
  let ultimoBom: CalendarioUtil | null = null;

  /* ------------------------------------------------------------ calendario */

  async function carregarCalendario(): Promise<CalendarioUtil> {
    const agoraMs = Date.now();
    if (cache && agoraMs < cache.ate) return cache.cal;
    try {
      const cal = calendarioDoPortal(await porta.calendarioTrabalho());
      ultimoBom = cal;
      cache = { cal, ate: agoraMs + TTL_CALENDARIO_MS };
      return cal;
    } catch (erro) {
      // Calendario e dado auxiliar: a falha da porta nao pode derrubar o pedido.
      logger.warn({
        evento: "ausencias.calendario.fallback",
        detalhe: { motivo: erro instanceof Error ? erro.name : "erro" },
      });
      const cal = ultimoBom ?? calendarioDoPortal(null);
      cache = { cal, ate: agoraMs + TTL_FALLBACK_MS };
      return cal;
    }
  }

  /** Para operacoes sincronas: ultimo calendario conhecido (fallback SA,SU). */
  function calendarioAtual(): CalendarioUtil {
    return cache?.cal ?? ultimoBom ?? calendarioDoPortal(null);
  }

  /* -------------------------------------------------------------- contexto */

  function sessaoReal(sessao: SessaoDemo): SessaoResolvida {
    return resolverSessao(m, sessao);
  }

  function dadosVisao(): DadosVisao {
    return {
      pessoas: new Map(listarPessoas(m).map((p) => [p.id, p])),
      tipos: new Map(listarTipos(m).map((t) => [t.id, t])),
      etapas: listarEtapas(m),
      equipes: listarEquipes(m),
      hoje: relogio.hoje(),
    };
  }

  function sessaoComPapelDoBanco(s: SessaoResolvida): SessaoDemo {
    return { pessoaId: s.pessoa.id, papel: s.papel };
  }

  function tipoOuErro(tipoId: string): Tipo {
    const tipo = listarTipos(m).find((t) => t.id === tipoId);
    if (!tipo) throw erroCampo("tipoId", "Escolha um tipo de ausência da lista.");
    return tipo;
  }

  function exigirAdmin(s: SessaoResolvida): void {
    if (!ehAdmin({ papel: s.papel })) throw semPermissao();
  }

  /** Pedido por id, SO se a sessao puder ve-lo (senao 404). Motivo privado so p/ dono/admin. */
  function pedidoVisivel(s: SessaoResolvida, pedidoId: number): { pedido: Pedido; dona: Pessoa } {
    const bruto = lerPedidoInterno(m, pedidoId);
    if (!bruto) throw negadoComoInexistente();
    const dona = obterPessoa(m, bruto.pessoaId);
    if (!dona) throw negadoComoInexistente();
    const eu = { id: s.pessoa.id, papel: s.papel, equipeId: s.pessoa.equipeId, aprovadorId: s.pessoa.aprovadorId };
    if (!podeVer(eu, dona, listarEquipes(m))) throw negadoComoInexistente();
    const veMotivo = bruto.pessoaId === s.pessoa.id || s.papel === "admin";
    const pedido = veMotivo ? ((lerPedidoInterno(m, pedidoId, { comMotivoPrivado: true }) as Pedido) ?? bruto) : bruto;
    return { pedido, dona };
  }

  function ator(s: SessaoResolvida) {
    return { id: s.pessoa.id, papel: s.papel, equipeId: s.pessoa.equipeId, aprovadorId: s.pessoa.aprovadorId };
  }

  /* ------------------------------------------------------------------ saldo */

  interface Calculo {
    dias: DataISO[];
    diasUteis: number;
    diasDebitoPorAno: Record<string, number>;
    excedeSaldo: boolean;
    saldoDepois: number;
  }

  function calcular(
    pessoa: Pessoa,
    tipo: Tipo,
    inicio: DataISO,
    fim: DataISO,
    cal: CalendarioUtil,
    ignorarPedidoId?: number,
  ): Calculo {
    const dias = diasUteisEntre(inicio, fim, cal);
    if (!tipo.consomeSaldo || dias.length === 0) {
      return { dias, diasUteis: dias.length, diasDebitoPorAno: {}, excedeSaldo: false, saldoDepois: 0 };
    }
    const pedidos = listarDebitosDaPessoa(m, pessoa.id)
      .map((d) => d.pedido)
      .filter((p) => p.id !== ignorarPedidoId);
    const sim = simularPedido({
      pessoaId: pessoa.id,
      carteira: tipo.consomeSaldo,
      hoje: relogio.hoje(),
      lancamentos: lancamentosDaPessoa(m, pessoa.id),
      pedidos,
      tipos: listarTipos(m),
      cal,
      tipoId: tipo.id,
      inicio,
      fim,
    });
    return {
      dias,
      diasUteis: sim.diasUteis,
      diasDebitoPorAno: sim.diasDebitoPorAno,
      excedeSaldo: sim.excedeSaldo,
      saldoDepois: sim.saldoDepois ?? 0,
    };
  }

  function disponivelDe(pessoaId: string, carteira: Carteira, cal: CalendarioUtil, ignorarPedidoId?: number) {
    return calcularSaldo({
      pessoaId,
      carteira,
      hoje: relogio.hoje(),
      lancamentos: lancamentosDaPessoa(m, pessoaId),
      pedidos: listarDebitosDaPessoa(m, pessoaId)
        .map((d) => d.pedido)
        .filter((p) => p.id !== ignorarPedidoId),
      tipos: listarTipos(m),
      cal,
    });
  }

  /* --------------------------------------------------------------- cobertura */

  function pedidosDaEquipe(membros: readonly Pessoa[]): Pedido[] {
    const lista: Pedido[] = [];
    for (const p of membros) lista.push(...listarPedidosDaPessoa(m, p.id, ["pendente", "aprovada", "cancelada"]));
    return lista;
  }

  function entradaCobertura(equipe: Equipe, cal: CalendarioUtil, ignorarPedidoId?: number) {
    const pessoas = listarPessoas(m);
    const membros = membrosDaEquipe(equipe, pessoas);
    const pedidos: PedidoCobertura[] = pedidosDaEquipe(membros).filter((p) => p.id !== ignorarPedidoId);
    return { equipe, pessoas, pedidos, cal };
  }

  function validarJanela(de: DataISO, ate: DataISO): void {
    if (de > ate) throw erroCampo("ate", "A data final vem antes da inicial.");
    if (diasEntre(de, ate) > JANELA_MAX_DIAS) throw erroCampo("ate", "Escolha no máximo três meses por vez.");
  }

  function equipeVisivel(s: SessaoResolvida, equipeId: string): Equipe {
    if (s.papel === "colaborador") throw semPermissao();
    const equipe = obterEquipe(m, equipeId);
    if (!equipe) throw negadoComoInexistente();
    if (!podeVerEquipe(ator(s), equipe, listarEquipes(m))) throw semPermissao();
    return equipe;
  }

  function diasDoCalendario(equipe: Equipe, cal: CalendarioUtil, de: DataISO, ate: DataISO): DiaCalendarioVisao[] {
    const entrada = entradaCobertura(equipe, cal);
    return pessoasTrabalhandoPorDia({ ...entrada, de, ate }).map((d) => ({
      data: d.data,
      util: d.util,
      feriado: d.feriado,
      trabalhando: d.trabalhando,
      abaixoDoMinimo: d.abaixoDoMinimo,
    }));
  }

  /* ----------------------------------------------------------- notificacoes */

  function etapaPorChave(chave: string): Etapa | undefined {
    return listarEtapas(m).find((e) => e.chave === chave);
  }

  function auditar(atorId: string, acao: string, entidade: string, entidadeId: string | number, detalhe?: Record<string, unknown>) {
    registrarAuditoria(m, { em: relogio.agora(), atorId, acao, entidade, entidadeId, detalhe });
  }

  /** Avisa no Bitrix (melhor esforco, APOS a transacao). Texto sem motivo; BBCode escapado. */
  async function avisarBitrix(destinos: DestinoBitrix[]): Promise<void> {
    for (const d of destinos) {
      const pessoa = obterPessoa(m, d.pessoaId);
      if (!pessoa || pessoa.bitrixUserId === undefined) continue;
      try {
        await porta.notificar(pessoa.bitrixUserId, escaparBBCode(d.texto));
      } catch (erro) {
        logger.warn({
          evento: "ausencias.notificacao.bitrix.falha",
          detalhe: { pedido: undefined, motivo: erro instanceof Error ? erro.name : "erro" },
        });
      }
    }
  }

  async function sincronizar(): Promise<number> {
    return processarFilaSincronizacao({ portalMemberId: m, relogio, porta, opcoesExecutor: deps.opcoesExecutor });
  }

  /* --------------------------------------------------------------- servicos */

  const servicos: ServicosAusenciasImpl = {
    aquecerCalendario: async () => {
      await carregarCalendario();
    },
    processarSincronizacao: () => sincronizar(),

    eu(sessao): PessoaVisao {
      return paraVisaoPessoa(sessaoReal(sessao).pessoa);
    },

    tiposPediveis(sessao) {
      const s = sessaoReal(sessao);
      return listarTipos(m).filter((t) => t.quemPede === "todos" || s.papel === "admin");
    },

    previa(sessao, entrada: EntradaCriarPedido): PreviaPedido {
      const e = criarPedidoSchema.parse(entrada);
      const s = sessaoReal(sessao);
      const tipo = tipoOuErro(e.tipoId);
      if (tipo.quemPede === "admin" && s.papel !== "admin") throw semPermissao("Este tipo é lançado pelo administrador.");
      const cal = calendarioAtual();
      const pessoa = s.pessoa;
      const calculo = calcular(pessoa, tipo, e.inicio, e.fim, cal);
      const equipe = obterEquipe(m, pessoa.equipeId);
      const aprovador = obterPessoa(m, pessoa.aprovadorId);
      if (!equipe || !aprovador) throw negadoComoInexistente();

      const cob = entradaCobertura(equipe, cal);
      const conflitoEquipe =
        calculo.diasUteis > 0 && haConflitoDeEquipe(cob, { pessoaId: pessoa.id, inicio: e.inicio, fim: e.fim });
      let datasLivres: { inicio: DataISO; fim: DataISO }[] = [];
      if (calculo.diasUteis > 0) {
        try {
          datasLivres = melhorJanela({ ...cob, n: calculo.diasUteis, hoje: relogio.hoje(), pessoaId: pessoa.id }).map((j) => ({
            inicio: j.inicio,
            fim: j.fim,
          }));
        } catch (erro) {
          if (!(erro instanceof ErroDominio)) throw erro;
          datasLivres = []; // periodo maior que o horizonte da busca: sem sugestao
        }
      }
      return {
        diasUteis: calculo.diasUteis,
        diasDebitoPorAno: calculo.diasDebitoPorAno,
        excedeSaldo: calculo.excedeSaldo,
        saldoDepois: calculo.saldoDepois,
        aprovador: paraVisaoPessoa(aprovador),
        conflitoEquipe,
        datasLivres,
      };
    },

    async solicitar(sessao, entrada: EntradaCriarPedido): Promise<PedidoVisao> {
      const e = criarPedidoSchema.parse(entrada);
      const s = sessaoReal(sessao);
      const tipo = tipoOuErro(e.tipoId);
      if (tipo.quemPede === "admin" && s.papel !== "admin") throw semPermissao("Este tipo é lançado pelo administrador.");
      if (tipo.sensivel && e.justificativa !== undefined) {
        throw erroCampo("justificativa", "Este tipo não aceita justificativa aberta. Use o campo de motivo privado.");
      }
      if (!tipo.sensivel && e.motivoPrivado !== undefined) {
        throw erroCampo("motivoPrivado", "Este tipo não usa motivo privado.");
      }

      const cal = await carregarCalendario();
      const pessoa = s.pessoa;

      try {
        verificarSobreposicao({
          pedidos: listarPedidosDaPessoa(m, pessoa.id, ["pendente", "aprovada"]),
          pessoaId: pessoa.id,
          inicio: e.inicio,
          fim: e.fim,
          cal,
        });
      } catch (erro) {
        if (erro instanceof ErroDominio && erro.subcodigo === "SOBREPOSICAO") {
          throw conflito("Você já tem um pedido nesses dias. Escolha outras datas.");
        }
        throw erro;
      }

      const agora = relogio.agora();
      const etapaGestor = etapaPorChave("com_gestor");
      const prazoEm = etapaGestor?.prazoHoras ? somarHoras(agora, etapaGestor.prazoHoras) : undefined;
      const aprovador = obterPessoa(m, pessoa.aprovadorId);
      const destinos: DestinoBitrix[] = [];

      let criado: Pedido;
      try {
        criado = emTransacao(() => {
          // O saldo deriva de pedidos e lançamentos: leia e valide sob o mesmo
          // lock IMMEDIATE que protege a gravação, sem qualquer await aqui.
          const calculo = calcular(pessoa, tipo, e.inicio, e.fim, cal);
          if (calculo.diasUteis < 1) throw erroCampo("fim", "O período escolhido não tem dias úteis.");
          if (!tipo.sensivel && calculo.excedeSaldo && e.justificativa === undefined) {
            throw erroCampo("justificativa", "Seu saldo não cobre o período. Explique por que você precisa desses dias.");
          }
          const p = criarPedido(m, {
            pessoaId: pessoa.id,
            tipoId: tipo.id,
            inicio: e.inicio,
            fim: e.fim,
            diasUteis: calculo.diasUteis,
            diasDebitoPorAno: calculo.diasDebitoPorAno,
            diasOcupados: calculo.dias,
            justificativa: tipo.sensivel ? undefined : e.justificativa,
            motivoPrivado: tipo.sensivel ? e.motivoPrivado : undefined,
            excedeSaldo: calculo.excedeSaldo,
            prazoEm,
            criadoEm: agora,
          });
          const tEnviado = textoDaEtapa(etapaPorChave("enviado"), p, pessoa, tipo);
          const tGestor = textoDaEtapa(etapaGestor, p, pessoa, tipo);
          gravarNotificacao(m, { pessoaId: pessoa.id, pedidoId: p.id, etapa: "enviado", texto: tEnviado, criadaEm: agora });
          gravarNotificacao(m, { pessoaId: pessoa.id, pedidoId: p.id, etapa: "com_gestor", texto: tGestor, criadaEm: agora });
          destinos.push({ pessoaId: pessoa.id, texto: tGestor });
          if (aprovador) {
            const aviso = `${pessoa.nome} pediu ${rotuloPublicoDoTipo(tipo)} (${periodoCurto(p.inicio, p.fim)}).`;
            gravarNotificacao(m, { pessoaId: aprovador.id, pedidoId: p.id, etapa: "novo", texto: aviso, criadaEm: agora });
            destinos.push({ pessoaId: aprovador.id, texto: aviso });
          }
          auditar(pessoa.id, "pedido.criado", "pedido", p.id, {
            tipoId: tipo.id,
            diasUteis: p.diasUteis,
            excedeSaldo: p.excedeSaldo,
            status: p.status,
          });
          return p;
        });
      } catch (erro) {
        if (erro instanceof ErroDominio && erro.subcodigo === "SOBREPOSICAO") {
          throw conflito("Você já tem um pedido nesses dias. Escolha outras datas.");
        }
        throw erro;
      }

      await avisarBitrix(destinos);
      const visto = lerPedidoInterno(m, criado.id, { comMotivoPrivado: true }) as Pedido;
      return paraVisao(visto, s, dadosVisao());
    },

    async decidir(sessao, pedidoId, entrada: EntradaDecidir): Promise<PedidoVisao> {
      const e = decidirPedidoSchema.parse(entrada);
      const s = sessaoReal(sessao);
      const { pedido, dona } = pedidoVisivel(s, pedidoId);
      if (!podeDecidir(ator(s), dona, pedido, listarEquipes(m))) throw negadoComoInexistente();
      if (e.versao !== pedido.versao) {
        throw conflito("Este pedido mudou enquanto você olhava. Atualize a tela e confira de novo.");
      }
      const tipo = listarTipos(m).find((t) => t.id === pedido.tipoId) as Tipo;
      const aprovar = e.decisao === "aprovar";
      const agora = relogio.agora();

      // A busca assíncrona fica fora da transação; o saldo será lido sob o lock.
      const cal = aprovar ? await carregarCalendario() : null;

      const chaveEtapa = aprovar ? "confirmado" : "recusado";
      const destinos: DestinoBitrix[] = [];
      try {
        emTransacao(() => {
          let recalculo: DecisaoPedido["recalculo"];
          if (cal) {
            const novo = calcular(dona, tipo, pedido.inicio, pedido.fim, cal, pedido.id);
            const total = novo.diasUteis;
            if (total !== pedido.diasUteis && e.confirmarRecalculo !== true) {
              throw conflito(`Os dias úteis mudaram de ${pedido.diasUteis} para ${total}. Confirme o recálculo para aprovar.`);
            }
            recalculo = {
              diasUteis: novo.diasUteis,
              diasDebitoPorAno: novo.diasDebitoPorAno,
              excedeSaldo: novo.excedeSaldo,
              diasOcupados: novo.dias,
            };
          }
          const atualizado = decidirPedido(m, {
            pedidoId: pedido.id,
            versao: e.versao,
            decisao: e.decisao,
            decididoPor: s.pessoa.id,
            decididoEm: agora,
            motivoDecisao: e.motivoDecisao,
            sugestao: aprovar ? undefined : e.sugestao,
            recalculo,
          });
          const texto = textoDaEtapa(etapaPorChave(chaveEtapa), atualizado, dona, tipo);
          gravarNotificacao(m, { pessoaId: dona.id, pedidoId: pedido.id, etapa: chaveEtapa, texto, criadaEm: agora });
          destinos.push({ pessoaId: dona.id, texto });
          auditar(s.pessoa.id, aprovar ? "pedido.aprovado" : "pedido.recusado", "pedido", pedido.id, {
            status: atualizado.status,
            comSugestao: atualizado.sugestao !== undefined,
          });
        });
      } catch (erro) {
        if (erro instanceof ErroDominio && erro.subcodigo === "TRANSICAO_INVALIDA") {
          throw conflito("Este pedido mudou enquanto você olhava. Atualize a tela e confira de novo.");
        }
        if (erro instanceof ErroDominio && erro.subcodigo === "SOBREPOSICAO") {
          throw conflito("Os dias deste pedido agora colidem com outro pedido da pessoa.");
        }
        throw erro;
      }

      if (aprovar) await sincronizar().catch(() => { logger.warn({ evento: "ausencias.sincronizacao.falha" }); });
      await avisarBitrix(destinos);
      return paraVisao(pedidoVisivel(s, pedido.id).pedido, s, dadosVisao());
    },

    async cancelar(sessao, pedidoId): Promise<PedidoVisao> {
      const s = sessaoReal(sessao);
      const { pedido, dona } = pedidoVisivel(s, pedidoId);
      const hoje = relogio.hoje();
      if (!podeCancelar(ator(s), dona, pedido, hoje, listarEquipes(m))) throw negadoComoInexistente();

      const tipo = listarTipos(m).find((t) => t.id === pedido.tipoId) as Tipo;
      const cal = await carregarCalendario();
      // Estorno so dos dias >= hoje: o debito passa a valer ate `hoje - 1`.
      const debito: Record<string, number> = {};
      if (tipo.consomeSaldo) {
        const ultimo = somarDias(hoje, -1);
        const fimVigente = ultimo < pedido.fim ? ultimo : pedido.fim;
        const passado = fimVigente < pedido.inicio ? {} : calcularDebitoPorAno(pedido.inicio, fimVigente, cal);
        for (const [ano, dias] of Object.entries(passado)) {
          // Alteracoes no calendario nao podem aumentar o debito congelado.
          const limitado = Math.min(dias, pedido.diasDebitoPorAno[ano] ?? 0);
          if (limitado > 0) debito[ano] = limitado;
        }
      }
      const eraAprovada = pedido.status === "aprovada";
      const agora = relogio.agora();
      const destinos: DestinoBitrix[] = [];
      try {
        emTransacao(() => {
          cancelarPedido(m, {
            pedidoId: pedido.id,
            canceladoPor: s.pessoa.id,
            canceladoEm: hoje,
            instante: agora,
            diasDebitoPorAno: debito,
            versao: pedido.versao,
          });
          const texto = `Pedido de ${dona.nome} (${rotuloPublicoDoTipo(tipo)}, ${periodoCurto(pedido.inicio, pedido.fim)}) foi cancelado.`;
          const quemAvisar = dona.id === s.pessoa.id ? dona.aprovadorId : dona.id;
          gravarNotificacao(m, { pessoaId: quemAvisar, pedidoId: pedido.id, etapa: "cancelado", texto, criadaEm: agora });
          destinos.push({ pessoaId: quemAvisar, texto });
          auditar(s.pessoa.id, "pedido.cancelado", "pedido", pedido.id, { eraAprovada });
        });
      } catch (erro) {
        if (erro instanceof ErroDominio && erro.subcodigo === "TRANSICAO_INVALIDA") {
          throw conflito("Este pedido mudou enquanto você olhava. Atualize a tela e confira de novo.");
        }
        throw erro;
      }
      if (eraAprovada) await sincronizar().catch(() => { logger.warn({ evento: "ausencias.sincronizacao.falha" }); });
      await avisarBitrix(destinos);
      return paraVisao(pedidoVisivel(s, pedido.id).pedido, s, dadosVisao());
    },

    meusPedidos(sessao): PedidoVisao[] {
      const s = sessaoReal(sessao);
      const dados = dadosVisao();
      return listarPedidosVisiveis(m, sessaoComPapelDoBanco(s), { pessoaId: s.pessoa.id }).map((p) => paraVisao(p, s, dados));
    },

    paraAprovar(sessao): PedidoVisao[] {
      const s = sessaoReal(sessao);
      const dados = dadosVisao();
      const porId = new Map<number, Pedido>();
      for (const p of listarPedidosParaAprovar(m, sessaoComPapelDoBanco(s))) porId.set(p.id, p);
      // Aprovador designado de pessoas FORA da propria equipe (ex.: Renata -> Carlos).
      for (const pessoa of dados.pessoas.values()) {
        if (pessoa.aprovadorId !== s.pessoa.id || pessoa.id === s.pessoa.id) continue;
        for (const p of listarPedidosDaPessoa(m, pessoa.id, ["pendente"])) {
          if (!porId.has(p.id)) porId.set(p.id, p);
        }
      }
      return [...porId.values()]
        .filter((p) => podeDecidir(ator(s), dados.pessoas.get(p.pessoaId) as Pessoa, p, dados.equipes))
        .sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : a.id - b.id))
        .map((p) => paraVisao(p, s, dados));
    },

    pedido(sessao, pedidoId): PedidoVisao {
      const s = sessaoReal(sessao);
      return paraVisao(pedidoVisivel(s, pedidoId).pedido, s, dadosVisao());
    },

    impacto(sessao, pedidoId): ImpactoPedidoVisao {
      const s = sessaoReal(sessao);
      const { pedido, dona } = pedidoVisivel(s, pedidoId);
      const equipes = listarEquipes(m);
      if (!podeVerImpacto(ator(s), dona, equipes)) throw negadoComoInexistente();
      const equipe = obterEquipe(m, dona.equipeId);
      const tipo = listarTipos(m).find((t) => t.id === pedido.tipoId) as Tipo;
      if (!equipe) throw negadoComoInexistente();
      const cal = calendarioAtual();
      const hoje = relogio.hoje();

      const cob = entradaCobertura(equipe, cal, pedido.id);
      const semanas = piorDiaPorSemana(
        { ...cob, de: pedido.inicio, ate: pedido.fim },
        { pessoaId: dona.id, inicio: pedido.inicio, fim: pedido.fim },
      ).map((x) => ({ semanaInicio: x.semanaInicio, semPedido: x.semPedido, comPedido: x.comPedido }));

      const membros = membrosDaEquipe(equipe, cob.pessoas);
      const tambemForaNoPeriodo: ImpactoPedidoVisao["tambemForaNoPeriodo"] = [];
      for (const outro of membros) {
        if (outro.id === dona.id) continue;
        for (const x of listarPedidosDaPessoa(m, outro.id, ["pendente", "aprovada"])) {
          if (x.inicio <= pedido.fim && x.fim >= pedido.inicio) {
            tambemForaNoPeriodo.push({ pessoa: paraVisaoPessoa(outro), inicio: x.inicio, fim: x.fim });
          }
        }
      }

      let saldoAntes = 0;
      let saldoDepois = 0;
      if (tipo.consomeSaldo) {
        saldoDepois = disponivelDe(dona.id, tipo.consomeSaldo, cal).disponivel;
        saldoAntes = disponivelDe(dona.id, tipo.consomeSaldo, cal, pedido.id).disponivel;
      }

      const umAnoAtras = somarDias(hoje, -365);
      const tipos = new Map(listarTipos(m).map((t) => [t.id, t]));
      let fora12 = 0;
      for (const x of listarPedidosDaPessoa(m, dona.id, ["aprovada"])) {
        if (x.id === pedido.id || tipos.get(x.tipoId)?.sensivel) continue;
        const ini = x.inicio < umAnoAtras ? umAnoAtras : x.inicio;
        const fim = x.fim > hoje ? hoje : x.fim;
        if (fim >= ini) fora12 += diasUteisEntre(ini, fim, cal).length;
      }

      let alternativas: ImpactoPedidoVisao["alternativas"] = [];
      if (pedido.diasUteis >= 1) {
        try {
          alternativas = melhorJanela({ ...cob, n: pedido.diasUteis, hoje, pessoaId: dona.id }).map((j) => ({
            inicio: j.inicio,
            fim: j.fim,
            motivo: `Equipe com ${j.minTrabalhando} pessoas trabalhando (mínimo ${equipe.minimoPessoas}).`,
          }));
        } catch (erro) {
          if (!(erro instanceof ErroDominio)) throw erro;
        }
      }

      return { pedidoId: pedido.id, semanas, tambemForaNoPeriodo, saldoAntes, saldoDepois, foraUltimos12Meses: fora12, alternativas };
    },

    saldos(sessao): SaldoVisao[] {
      const s = sessaoReal(sessao);
      const cal = calendarioAtual();
      return (["ferias", "folga"] as Carteira[]).map((carteira) => {
        const r = disponivelDe(s.pessoa.id, carteira, cal);
        return { carteira, disponivel: r.disponivel, vencendo: r.vencendo };
      });
    },

    creditar(sessao, entrada: EntradaCreditar): void {
      const e = creditarSchema.parse(entrada);
      const s = sessaoReal(sessao);
      if (s.papel === "colaborador") throw semPermissao();
      const alvo = obterPessoa(m, e.pessoaId);
      if (!alvo) throw erroCampo("pessoaId", "Escolha uma pessoa da lista.");
      if (alvo.id === s.pessoa.id) throw semPermissao("Ninguém credita dias para si mesmo.");
      if (!podeCreditar(ator(s), alvo, listarEquipes(m))) throw semPermissao();
      const agora = relogio.agora();
      emTransacao(() => {
        const l = criarLancamento(m, {
          pessoaId: alvo.id,
          ano: e.ano ?? Number(relogio.hoje().slice(0, 4)),
          carteira: e.carteira,
          tipo: "credito",
          dias: e.dias,
          motivo: e.motivo,
          venceEm: e.venceEm,
          criadoPor: s.pessoa.id,
          criadoEm: agora,
        });
        auditar(s.pessoa.id, "saldo.creditado", "lancamento", l.id, { pessoaId: alvo.id, carteira: e.carteira, dias: e.dias });
      });
    },

    calendario(sessao, equipeId, de, ate): CalendarioVisao {
      const s = sessaoReal(sessao);
      const equipe = equipeVisivel(s, equipeId);
      validarJanela(de, ate);
      const cal = calendarioAtual();
      const cob = entradaCobertura(equipe, cal);
      const membros = membrosDaEquipe(equipe, cob.pessoas);
      const tipos = new Map(listarTipos(m).map((t) => [t.id, t]));
      const ausencias: AusenciaCalendarioVisao[] = [];
      for (const p of cob.pedidos as Pedido[]) {
        if (p.status === "recusada") continue;
        const v = p.status === "pendente" ? intervaloVigente(p) : intervaloQueConta(p, equipe.contarPendentes);
        if (!v || v.inicio > ate || v.fim < de) continue;
        const tipo = tipos.get(p.tipoId) as Tipo;
        ausencias.push({
          pedidoId: p.id,
          pessoaId: p.pessoaId,
          inicio: v.inicio,
          fim: v.fim,
          rotulo: tipo.sensivel ? ROTULO_PUBLICO_SENSIVEL : tipo.nome,
          cor: tipo.sensivel ? COR_NEUTRA : tipo.cor,
          pendente: p.status === "pendente",
        });
      }
      ausencias.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : a.pedidoId - b.pedidoId));
      return {
        equipeId: equipe.id,
        de,
        ate,
        pessoas: membros.map(paraVisaoPessoa),
        ausencias,
        dias: diasDoCalendario(equipe, cal, de, ate),
      };
    },

    disponibilidade(sessao, equipeId, de, ate): DisponibilidadeVisao {
      const s = sessaoReal(sessao);
      const equipe = equipeVisivel(s, equipeId);
      validarJanela(de, ate);
      const cal = calendarioAtual();
      const cob = entradaCobertura(equipe, cal);
      const membros = membrosDaEquipe(equipe, cob.pessoas);
      const dias = diasDoCalendario(equipe, cal, de, ate);
      const cobDias = pessoasTrabalhandoPorDia({ ...cob, de, ate });

      // "Atencao": pedidos ativos que levam a equipe abaixo do minimo (pendente = "se aprovar").
      const piorCaso = { ...cob, equipe: { ...equipe, contarPendentes: true } };
      const atencao: DisponibilidadeVisao["atencao"] = [];
      for (const p of cob.pedidos as Pedido[]) {
        if (p.status !== "pendente" && p.status !== "aprovada") continue;
        if (p.inicio > ate || p.fim < de) continue;
        const ini = p.inicio < de ? de : p.inicio;
        const fim = p.fim > ate ? ate : p.fim;
        const nesses = pessoasTrabalhandoPorDia({ ...piorCaso, de: ini, ate: fim }).filter((d) => d.util && d.abaixoDoMinimo);
        if (nesses.length === 0) continue;
        const nome = (cob.pessoas.find((x) => x.id === p.pessoaId) as Pessoa).nome;
        const menor = Math.min(...nesses.map((d) => d.trabalhando));
        atencao.push({
          pedidoId: p.id,
          texto: `${nome} (${periodoCurto(p.inicio, p.fim)}): ${nesses.length} dia(s) abaixo do mínimo, com ${menor} de ${membros.length} trabalhando${
            p.status === "pendente" ? " se aprovar" : ""
          }.`,
        });
      }
      return {
        equipeId: equipe.id,
        minimoPessoas: equipe.minimoPessoas,
        contarPendentes: equipe.contarPendentes,
        totalMembros: membros.length,
        dias,
        diasAbaixoDoMinimo: contarDiasAbaixoDoMinimo(cobDias),
        piorDia: piorDia(cobDias),
        atencao,
      };
    },

    painel(sessao, equipeId): PainelVisao {
      const s = sessaoReal(sessao);
      if (s.papel === "colaborador") throw semPermissao();
      const equipes = listarEquipes(m);
      const pessoas = listarPessoas(m);
      const cal = calendarioAtual();

      let escopo: "empresa" | "equipe";
      let alvoEquipe: string | undefined;
      let equipesDoEscopo: Equipe[];
      if (equipeId !== undefined) {
        const eq = equipeVisivel(s, equipeId);
        escopo = "equipe";
        alvoEquipe = eq.id;
        equipesDoEscopo = [eq];
      } else if (s.papel === "admin") {
        escopo = "empresa";
        equipesDoEscopo = equipes;
      } else {
        const gerida = equipes.find((e) => gerenciaEquipe({ id: s.pessoa.id, papel: s.papel }, e.id, equipes));
        if (!gerida) throw semPermissao();
        escopo = "equipe";
        alvoEquipe = gerida.id;
        equipesDoEscopo = [gerida];
      }
      const ids = new Set(equipesDoEscopo.map((e) => e.id));
      const gente = pessoas.filter((p) => ids.has(p.equipeId));
      const pedidos: Pedido[] = [];
      for (const p of gente) pedidos.push(...listarPedidosDaPessoa(m, p.id));
      const lancamentos = [];
      for (const eq of equipesDoEscopo) lancamentos.push(...lancamentosDaEquipe(m, eq.id));

      return indicadores({
        escopo,
        equipeId: alvoEquipe,
        equipes: equipesDoEscopo,
        pessoas,
        pedidos,
        tipos: listarTipos(m),
        lancamentos,
        cal,
        hoje: relogio.hoje(),
        agora: relogio.agora(),
      });
    },

    notificacoes(sessao): NotificacaoVisao[] {
      return listarNotificacoes(m, sessaoReal(sessao).pessoa.id);
    },

    lembrarGestor(sessao, pedidoId): void {
      const s = sessaoReal(sessao);
      // Rota [id]: negado = 404 (nao revela se o pedido existe).
      if (s.papel !== "admin") throw negadoComoInexistente();
      const { pedido, dona } = pedidoVisivel(s, pedidoId);
      if (pedido.status !== "pendente") throw conflito("Este pedido já foi decidido.");
      const tipo = listarTipos(m).find((t) => t.id === pedido.tipoId) as Tipo;
      const hoje = relogio.hoje();
      const agora = relogio.agora();
      const texto = `Lembrete: o pedido de ${dona.nome} (${rotuloPublicoDoTipo(tipo)}, ${periodoCurto(pedido.inicio, pedido.fim)}) aguarda sua resposta.`;
      // No maximo 1 lembrete por dia e pedido: a chave unica (pessoa, pedido, etapa) garante.
      const gravou = gravarNotificacao(m, {
        pessoaId: dona.aprovadorId,
        pedidoId: pedido.id,
        etapa: `lembrete:${hoje}`,
        texto,
        criadaEm: agora,
      });
      if (gravou) {
        auditar(s.pessoa.id, "pedido.lembrete", "pedido", pedido.id);
        void avisarBitrix([{ pessoaId: dona.aprovadorId, texto }]).catch(() => {});
      }
    },

    etapas(): Etapa[] {
      return listarEtapas(m);
    },

    editarEtapa(sessao, entrada: EntradaEtapa): Etapa[] {
      const s = sessaoReal(sessao);
      exigirAdmin(s);
      // Whitelist de variaveis {nome} {periodo} {tipoPublico} {prazo} (2a barreira alem da rota).
      const e = etapaSchema.parse(entrada);
      if (!listarEtapas(m).some((x) => x.chave === e.chave)) throw negadoComoInexistente();
      emTransacao(() => {
        salvarEtapa(m, {
          chave: e.chave,
          rotulo: e.rotulo,
          mensagem: e.mensagem,
          // Prazo so existe na etapa com_gestor.
          prazoHoras: e.chave === "com_gestor" ? e.prazoHoras : undefined,
        });
        auditar(s.pessoa.id, "etapa.editada", "etapa", e.chave);
      });
      return listarEtapas(m);
    },

    equipes(sessao): Equipe[] {
      const s = sessaoReal(sessao);
      const todas = listarEquipes(m);
      if (s.papel === "admin") return todas;
      if (s.papel === "gestor") return todas.filter((e) => e.gestorId === s.pessoa.id || e.id === s.pessoa.equipeId);
      return todas.filter((e) => e.id === s.pessoa.equipeId);
    },

    definirMinimo(sessao, equipeId, entrada: EntradaMinimo): Equipe {
      const e = minimoEquipeSchema.parse(entrada);
      const s = sessaoReal(sessao);
      if (s.papel === "colaborador") throw semPermissao();
      const equipe = obterEquipe(m, equipeId);
      if (!equipe) throw negadoComoInexistente();
      if (!podeEditarMinimo(ator(s), equipe, listarEquipes(m))) throw semPermissao();
      return emTransacao(() => {
        const nova = definirMinimoEquipe(m, equipe.id, e.minimoPessoas, e.contarPendentes);
        auditar(s.pessoa.id, "equipe.minimo", "equipe", equipe.id, {
          minimoPessoas: e.minimoPessoas,
          contarPendentes: e.contarPendentes,
        });
        return nova;
      });
    },

    logSincronizacao(sessao): SincronizacaoLogVisao[] {
      exigirAdmin(sessaoReal(sessao));
      return listarLogSincronizacao(m);
    },

    async reprocessarSincronizacao(sessao, pedidoId?): Promise<void> {
      const s = sessaoReal(sessao);
      exigirAdmin(s);
      if (pedidoId !== undefined && !lerPedidoInterno(m, pedidoId)) throw negadoComoInexistente();
      const reabertos = emTransacao(() => {
        const n = reprocessarJobs(m, relogio.agora(), pedidoId);
        auditar(s.pessoa.id, "sincronizacao.reprocessada", "sync_job", pedidoId ?? "todos", { reabertos: n });
        return n;
      });
      if (reabertos > 0) await sincronizar();
    },
  };
  return servicos;
}
