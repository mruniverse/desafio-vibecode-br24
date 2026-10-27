/**
 * Indicadores do Painel (BR24-005, requisito 6). Funcao pura: devolve o `PainelVisao`
 * do contrato; quem chama (C2) so filtra o escopo por papel.
 *
 * Definicoes (todas sobre os pedidos do escopo):
 *  - porStatus: contagem dos 4 status (chaves sempre presentes).
 *  - aguardandoGestor: `pendente`; atrasado = `prazoEm` ANTES de `agora` (igual nao e atraso).
 *  - diasPorTipo: dias UTEIS de ausencia de `hoje` a `hoje + 90` (inclusive), so de
 *    pedidos que contam como ausencia (aprovada; cancelada antes de `canceladoEm`;
 *    nunca pendente). Tipos sensiveis se fundem em "Ausencias" e a linha some
 *    quando envolve menos de 3 pessoas (supressao n < 3: nao revela quem esta de licenca).
 *  - feriasVencendo: carteira `ferias` com saldo que vence em ate 90 dias (FIFO de `saldo`).
 *  - diasAbaixoDoMinimoPorEquipe: dias uteis de `hoje` a `hoje + 90` com trabalhando < minimo.
 *  - taxaAprovacao: fracao de 0 a 1 = aprovados / (aprovados + recusados); `null` sem decisao.
 *    Aprovado = status aprovada, ou cancelada que ja tinha sido decidida (`decididoEm`).
 *  - tempoMedioDecisaoHoras: media de (decididoEm - criadoEm) em horas, 2 casas; `null` sem decisao.
 */
import { compararInstantes, horasEntre, somarDias, validarData, validarInstante, type DataISO, type InstanteISO } from "./datas";
import { diasUteisEntre, type CalendarioUtil } from "./dias-uteis";
import { ErroDominio } from "./erros";
import { contarDiasAbaixoDoMinimo, intervaloQueConta, pessoasTrabalhandoPorDia } from "./cobertura";
import { saldo } from "./saldo";
import { ROTULO_PUBLICO_SENSIVEL, type Equipe, type Lancamento, type Pedido, type Pessoa, type StatusPedido, type Tipo } from "./tipos";
import type { PainelVisao, PessoaVisao } from "./visoes";

/** Janela de "proximos N dias" do Painel e do "vencendo". */
export const HORIZONTE_PAINEL_DIAS = 90;
/** Linha sensivel com menos pessoas que isto e suprimida. */
export const SUPRESSAO_MINIMA = 3;
/** Rotulo do agregado de tipos sensiveis no Painel ("Ausencias"). */
export const ROTULO_AGREGADO_SENSIVEL = `${ROTULO_PUBLICO_SENSIVEL}s`;

export interface EntradaIndicadores {
  escopo: "empresa" | "equipe";
  /** Obrigatorio quando `escopo = "equipe"`. */
  equipeId?: string;
  equipes: readonly Equipe[];
  pessoas: readonly Pessoa[];
  pedidos: readonly Pedido[];
  tipos: readonly Tipo[];
  lancamentos: readonly Lancamento[];
  cal: CalendarioUtil;
  hoje: DataISO;
  agora: InstanteISO;
}

function paraVisao(p: Pessoa): PessoaVisao {
  const v: PessoaVisao = { id: p.id, nome: p.nome, equipeId: p.equipeId, papel: p.papel };
  if (p.funcao !== undefined) v.funcao = p.funcao;
  return v;
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function indicadores(entrada: EntradaIndicadores): PainelVisao {
  const hoje = validarData(entrada.hoje, "hoje");
  const agora = validarInstante(entrada.agora, "agora");
  if (entrada.escopo !== "empresa" && entrada.escopo !== "equipe") {
    throw new ErroDominio("NAO_ENCONTRADO", "escopo desconhecido");
  }

  let equipes: readonly Equipe[] = entrada.equipes;
  let pessoas: readonly Pessoa[] = entrada.pessoas;
  if (entrada.escopo === "equipe") {
    const equipe = entrada.equipes.find((e) => e.id === entrada.equipeId);
    if (equipe === undefined) throw new ErroDominio("NAO_ENCONTRADO", "equipe do escopo nao encontrada");
    equipes = [equipe];
    pessoas = entrada.pessoas.filter((p) => p.equipeId === equipe.id);
  }
  const idsPessoas = new Set(pessoas.map((p) => p.id));
  const pedidos = entrada.pedidos.filter((p) => idsPessoas.has(p.pessoaId));
  const tipos = new Map(entrada.tipos.map((t) => [t.id, t]));
  const fimHorizonte = somarDias(hoje, HORIZONTE_PAINEL_DIAS);

  const porStatus: Record<StatusPedido, number> = { pendente: 0, aprovada: 0, recusada: 0, cancelada: 0 };
  for (const p of pedidos) {
    if (!(p.status in porStatus)) throw new ErroDominio("TRANSICAO_INVALIDA", `status desconhecido no pedido ${p.id}`);
    porStatus[p.status] += 1;
  }

  const pendentes = pedidos.filter((p) => p.status === "pendente");
  const atrasados = pendentes.filter((p) => p.prazoEm !== undefined && compararInstantes(p.prazoEm, agora) < 0).length;

  // Dias de ausencia por tipo nos proximos 90 dias.
  const porTipo = new Map<string, { rotulo: string; dias: number }>();
  const sensivel = { dias: 0, pessoas: new Set<string>() };
  for (const p of pedidos) {
    const f = intervaloQueConta(p, false);
    if (f === null) continue;
    const ini = f.inicio > hoje ? f.inicio : hoje;
    const fim = f.fim < fimHorizonte ? f.fim : fimHorizonte;
    if (fim < ini) continue;
    const tipo = tipos.get(p.tipoId);
    if (tipo === undefined) throw new ErroDominio("NAO_ENCONTRADO", `tipo do pedido ${p.id} desconhecido`);
    const dias = diasUteisEntre(ini, fim, entrada.cal).length;
    if (dias === 0) continue;
    if (tipo.sensivel) {
      sensivel.dias += dias;
      sensivel.pessoas.add(p.pessoaId);
    } else {
      const atual = porTipo.get(tipo.id) ?? { rotulo: tipo.nome, dias: 0 };
      atual.dias += dias;
      porTipo.set(tipo.id, atual);
    }
  }
  const diasPorTipo = [...porTipo.values()];
  if (sensivel.pessoas.size >= SUPRESSAO_MINIMA) {
    diasPorTipo.push({ rotulo: ROTULO_AGREGADO_SENSIVEL, dias: sensivel.dias });
  }
  diasPorTipo.sort((a, b) => b.dias - a.dias || (a.rotulo < b.rotulo ? -1 : 1));

  const feriasVencendo: PainelVisao["feriasVencendo"] = [];
  for (const pessoa of pessoas) {
    const { vencendo } = saldo({
      pessoaId: pessoa.id,
      carteira: "ferias",
      hoje,
      lancamentos: entrada.lancamentos,
      pedidos,
      tipos: entrada.tipos,
      cal: entrada.cal,
    });
    if (vencendo !== null) feriasVencendo.push({ pessoa: paraVisao(pessoa), dias: vencendo.dias, venceEm: vencendo.venceEm });
  }
  feriasVencendo.sort((a, b) => (a.venceEm === b.venceEm ? (a.pessoa.id < b.pessoa.id ? -1 : 1) : a.venceEm < b.venceEm ? -1 : 1));

  const diasAbaixoDoMinimoPorEquipe = equipes.map((equipe) => ({
    equipeId: equipe.id,
    nome: equipe.nome,
    dias: contarDiasAbaixoDoMinimo(
      pessoasTrabalhandoPorDia({ equipe, pessoas: entrada.pessoas, pedidos, cal: entrada.cal, de: hoje, ate: fimHorizonte }),
    ),
  }));

  const recusados = porStatus.recusada;
  const aprovados = porStatus.aprovada + pedidos.filter((p) => p.status === "cancelada" && p.decididoEm !== undefined).length;
  const taxaAprovacao = aprovados + recusados === 0 ? null : aprovados / (aprovados + recusados);

  const tempos = pedidos
    .filter((p) => p.decididoEm !== undefined)
    .map((p) => {
      const horas = horasEntre(p.criadoEm, p.decididoEm as InstanteISO);
      if (horas < 0) throw new ErroDominio("INTERVALO_INVALIDO", `pedido ${p.id}: decisao anterior a criacao`);
      return horas;
    });
  const tempoMedioDecisaoHoras = tempos.length === 0 ? null : arredondar(tempos.reduce((a, b) => a + b, 0) / tempos.length);

  return {
    escopo: entrada.escopo,
    porStatus,
    aguardandoGestor: { total: pendentes.length, atrasados },
    diasPorTipo,
    feriasVencendo,
    diasAbaixoDoMinimoPorEquipe,
    taxaAprovacao,
    tempoMedioDecisaoHoras,
  };
}
