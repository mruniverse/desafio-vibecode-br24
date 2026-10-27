/**
 * Dados de DEMONSTRACAO de pedidos (BR24-005): a cena do pitch.
 *
 * `seed.ts` (C2) cria catalogo, pessoas e saldos, mas NENHUM pedido. Este
 * modulo cria os pedidos de exemplo usando o DOMINIO PURO e os repositorios
 * (nada de SQL de pedido aqui): a Ana pede ferias na semana de 16/11/2026, a
 * equipe de Tecnologia cai de 5 para 4 pessoas com minimo 5, e ha pedidos
 * pendentes, historico aprovado e recusado (com motivo e sugestao).
 *
 *  - So roda com MODO_DEMO=1 e SO escreve no portal `demo:ficticio`.
 *  - Idempotente: se o portal ja tem pedido `origem='seed'`, nao faz nada.
 *  - Dados 100% ficticios. Sem rede.
 *
 * Alem dos pedidos, completa o cenario com o que o prototipo mostrava e o seed
 * enxuto nao traz: equipes Produto e Comercial (com gestor, pessoas e
 * aprovadores), saldo do ciclo da data de demonstracao (12 dias de ferias,
 * competencia 2026 — o seed so cria a competencia seguinte), dois lotes de
 * ferias a vencer e o vinculo fictício com usuarios do Bitrix (so quando a
 * escrita real esta DESLIGADA; com BITRIX_ESCRITA=1 o vinculo e do operador).
 *
 * Sem enum/namespace/propriedade de parametro (strip-types dos testes).
 */
import { getEnv } from "@/lib/env";
import { ehDataISO, somarHoras } from "./datas";
import { calendarioDoPortal, diasUteisEntre } from "./dias-uteis";
import type { CalendarioUtil } from "./dias-uteis";
import { conexao, emTransacao } from "./repo/base";
import { obterPessoa } from "./repo/catalogo";
import { gravarNotificacao } from "./repo/notificacoes";
import { criarPedido, decidirPedido, listarDebitosDaPessoa } from "./repo/pedidos";
import { lancamentosDaPessoa } from "./repo/lancamentos";
import { concluirJob, esgotarJob, tomarProximoJob } from "./repo/sync";
import { listarEtapas, listarTipos } from "./repo/catalogo";
import { HOJE_DEMO, PORTAL_DEMO } from "./seed";
import { simularPedido } from "./saldo";
import { textoDaEtapa } from "./mensagens";
import type { DataISO, InstanteISO, StatusPedido } from "./tipos";

/** Mesmos feriados nacionais fixos do calendario padrao do FakeBitrix (dado publico). */
const FERIADOS_DEMO = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];

export function calendarioDemo(): CalendarioUtil {
  return calendarioDoPortal({ diasNaoUteis: ["SA", "SU"], feriados: FERIADOS_DEMO, excecoesTrabalhadas: [] });
}

/** Data de hoje da demonstracao: DEMO_HOJE (AAAA-MM-DD) ou 2026-10-26. */
export function hojeDemo(): DataISO {
  const env = process.env.DEMO_HOJE;
  if (env !== undefined && !ehDataISO(env)) throw new Error("DEMO_HOJE invalido");
  return env ?? HOJE_DEMO;
}

interface EquipeExtra {
  id: string;
  nome: string;
  gestorId: string;
  minimo: number;
}
interface PessoaExtra {
  id: string;
  nome: string;
  equipeId: string;
  papel: "colaborador" | "gestor";
  aprovadorId: string;
  funcao: string;
}

const EQUIPES_EXTRAS: EquipeExtra[] = [
  { id: "produto", nome: "Produto", gestorId: "rafael", minimo: 2 },
  { id: "comercial", nome: "Comercial", gestorId: "vinicius", minimo: 3 },
];

const PESSOAS_EXTRAS: PessoaExtra[] = [
  { id: "rafael", nome: "Rafael Souza", equipeId: "produto", papel: "gestor", aprovadorId: "renata", funcao: "Gestão" },
  { id: "paula", nome: "Paula Freitas", equipeId: "produto", papel: "colaborador", aprovadorId: "rafael", funcao: "Design" },
  { id: "lucas", nome: "Lucas Pereira", equipeId: "produto", papel: "colaborador", aprovadorId: "rafael", funcao: "Produto" },
  { id: "vinicius", nome: "Vinícius Alves", equipeId: "comercial", papel: "gestor", aprovadorId: "renata", funcao: "Gestão" },
  { id: "gabriel", nome: "Gabriel Costa", equipeId: "comercial", papel: "colaborador", aprovadorId: "vinicius", funcao: "Vendas" },
  { id: "helena", nome: "Helena Rocha", equipeId: "comercial", papel: "colaborador", aprovadorId: "vinicius", funcao: "Vendas" },
  { id: "igor", nome: "Igor Santos", equipeId: "comercial", papel: "colaborador", aprovadorId: "vinicius", funcao: "Pré-vendas" },
];

interface Semente {
  pessoaId: string;
  tipoId: string;
  inicio: DataISO;
  fim: DataISO;
  status: Exclude<StatusPedido, "cancelada">;
  criadoEm: InstanteISO;
  motivoPrivado?: string;
  motivoDecisao?: string;
  sugestao?: { inicio: DataISO; fim: DataISO };
  decididoPor?: string;
  /** Resultado da sincronizacao do evento no Bitrix (so aprovadas). */
  sync?: "ok" | "falha";
}

const SEMENTES: Semente[] = [
  // Historico da Ana: folga aprovada e pedido recusado COM motivo e sugestao.
  { pessoaId: "ana", tipoId: "folga", inicio: "2026-09-14", fim: "2026-09-14", status: "aprovada", criadoEm: "2026-09-02T13:00:00.000Z", decididoPor: "carlos", sync: "ok" },
  {
    pessoaId: "ana", tipoId: "outro", inicio: "2026-08-27", fim: "2026-08-27", status: "recusada", criadoEm: "2026-08-20T13:00:00.000Z",
    motivoDecisao: "Entrega da sprint nessa semana. Pode remarcar para a seguinte?", decididoPor: "carlos",
    sugestao: { inicio: "2026-09-03", fim: "2026-09-03" },
  },
  // Equipe Tecnologia na semana de 16/11: Bruno e Diego ja estao fora.
  { pessoaId: "bruno", tipoId: "ferias", inicio: "2026-11-16", fim: "2026-11-20", status: "aprovada", criadoEm: "2026-10-12T13:00:00.000Z", decididoPor: "carlos", sync: "ok" },
  { pessoaId: "diego", tipoId: "viagem", inicio: "2026-11-17", fim: "2026-11-19", status: "aprovada", criadoEm: "2026-10-14T13:00:00.000Z", decididoPor: "carlos", sync: "falha" },
  {
    pessoaId: "elisa", tipoId: "doenca", inicio: "2026-12-07", fim: "2026-12-09", status: "aprovada", criadoEm: "2026-10-20T13:00:00.000Z",
    motivoPrivado: "Procedimento agendado (texto fictício)", decididoPor: "carlos", sync: "ok",
  },
  // A CENA DO PITCH: Ana pede ferias na semana de 16/11 -> equipe cai de 5 para 4 (minimo 5).
  { pessoaId: "ana", tipoId: "ferias", inicio: "2026-11-16", fim: "2026-11-27", status: "pendente", criadoEm: "2026-10-25T15:00:00.000Z" },
  { pessoaId: "camila", tipoId: "ferias", inicio: "2026-12-14", fim: "2026-12-23", status: "pendente", criadoEm: "2026-10-22T10:00:00.000Z" },
  { pessoaId: "carlos", tipoId: "ferias", inicio: "2027-02-15", fim: "2027-02-24", status: "pendente", criadoEm: "2026-10-24T12:00:00.000Z" },
  { pessoaId: "paula", tipoId: "ferias", inicio: "2026-12-21", fim: "2027-01-08", status: "pendente", criadoEm: "2026-10-23T12:00:00.000Z" },
  { pessoaId: "lucas", tipoId: "viagem", inicio: "2026-11-09", fim: "2026-11-11", status: "aprovada", criadoEm: "2026-10-15T12:00:00.000Z", decididoPor: "rafael", sync: "ok" },
  { pessoaId: "gabriel", tipoId: "ferias", inicio: "2026-11-23", fim: "2026-12-04", status: "pendente", criadoEm: "2026-10-26T09:00:00.000Z" },
  { pessoaId: "helena", tipoId: "ferias", inicio: "2026-11-23", fim: "2026-11-27", status: "aprovada", criadoEm: "2026-10-10T12:00:00.000Z", decididoPor: "vinicius", sync: "ok" },
  { pessoaId: "marina", tipoId: "outro", inicio: "2026-11-05", fim: "2026-11-06", status: "pendente", criadoEm: "2026-10-26T10:00:00.000Z" },
];

export interface ResultadoDemoPedidos {
  executado: boolean;
  pedidos: number;
  motivo?: string;
}

/** Garante equipes/pessoas extras, saldo do ciclo e vinculos fictícios (idempotente). */
function completarCenario(portal: string, hoje: DataISO): void {
  const db = conexao();
  const m = portal;
  const ano = Number(hoje.slice(0, 4));
  const instante = `${hoje}T12:00:00.000Z`;

  const insEquipe = db.prepare(
    `INSERT INTO equipe (portal_member_id, id, nome, gestor_id, minimo_pessoas, contar_pendentes, origem)
     VALUES (?, ?, ?, ?, ?, 0, 'seed') ON CONFLICT DO NOTHING`,
  );
  for (const e of EQUIPES_EXTRAS) insEquipe.run(m, e.id, e.nome, e.gestorId, e.minimo);
  const insPessoa = db.prepare(
    `INSERT INTO pessoa (portal_member_id, id, nome, equipe_id, papel, aprovador_id, funcao, origem)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'seed') ON CONFLICT DO NOTHING`,
  );
  for (const p of PESSOAS_EXTRAS) insPessoa.run(m, p.id, p.nome, p.equipeId, p.papel, p.aprovadorId, p.funcao);

  const insLanc = db.prepare(
    `INSERT INTO lancamento (portal_member_id, pessoa_id, ano, carteira, tipo, dias, motivo, vence_em,
                             criado_por, criado_em, origem, chave_natural)
     VALUES (?, ?, ?, ?, 'credito', ?, ?, ?, ?, ?, 'seed', ?) ON CONFLICT DO NOTHING`,
  );
  const todas = db
    .prepare("SELECT id FROM pessoa WHERE portal_member_id = ? ORDER BY id")
    .all(m) as { id: string }[];
  for (const p of todas) {
    const quem = p.id === "marina" ? "paulo" : "marina";
    // Seed do C2 so cria a competencia seguinte; a demo vive no ciclo corrente.
    insLanc.run(m, p.id, ano, "ferias", 12, "Saldo do ciclo corrente da demonstração (dados fictícios)", `${ano + 1}-06-30`, quem, instante, `demo:${p.id}:ferias:${ano}`);
  }
  // Ferias do periodo anterior que vencem em breve (alimentam "Ferias vencendo").
  insLanc.run(m, "elisa", ano, "ferias", 6, "Férias do período anterior (ficção)", `${ano + 1}-01-15`, "marina", instante, `demo:elisa:ferias:${ano}:antigo`);
  insLanc.run(m, "felipe", ano, "ferias", 4, "Férias do período anterior (ficção)", `${ano + 1}-01-20`, "marina", instante, `demo:felipe:ferias:${ano}:antigo`);

  // Vinculo FICTICIO com usuarios do Bitrix (ownerId do evento). Com escrita real ligada
  // o vinculo e do operador: nunca inventamos ids que poderiam apontar para gente de verdade.
  if (getEnv().BITRIX_ESCRITA !== "1") {
    const upd = db.prepare(
      "UPDATE pessoa SET bitrix_user_id = ? WHERE portal_member_id = ? AND id = ? AND bitrix_user_id IS NULL",
    );
    todas.forEach((p, i) => upd.run(9001 + i, m, p.id));
  }
}

/**
 * Cria os pedidos da demonstracao. `cal` e o calendario usado para contar dias
 * (padrao: SA,SU + feriados nacionais fixos, igual ao do FakeBitrix).
 */
export function semearPedidosDemo(opcoes: { hoje?: DataISO; cal?: CalendarioUtil } = {}): ResultadoDemoPedidos {
  if (getEnv().MODO_DEMO !== "1") return { executado: false, pedidos: 0, motivo: "MODO_DEMO != 1" };
  const m = PORTAL_DEMO;
  const hoje = opcoes.hoje ?? hojeDemo();
  const cal = opcoes.cal ?? calendarioDemo();

  let criados = 0;
  emTransacao(() => {
    const ja = conexao().prepare("SELECT COUNT(*) AS n FROM pedido WHERE portal_member_id = ? AND origem = 'seed'").get(m) as { n: number };
    if (ja.n > 0) return;
    completarCenario(m, hoje);
    const tipos = listarTipos(m);
    const etapas = listarEtapas(m);
    const prazoHoras = etapas.find((e) => e.chave === "com_gestor")?.prazoHoras;

    for (const s of SEMENTES) {
      const tipo = tipos.find((t) => t.id === s.tipoId);
      const pessoa = obterPessoa(m, s.pessoaId);
      if (!tipo || !pessoa) throw new Error(`semente de demonstracao invalida: ${s.pessoaId}/${s.tipoId}`);
      const dias = diasUteisEntre(s.inicio, s.fim, cal);
      const sim = simularPedido({
        pessoaId: pessoa.id,
        carteira: tipo.consomeSaldo ?? "ferias",
        hoje,
        lancamentos: lancamentosDaPessoa(m, pessoa.id),
        pedidos: listarDebitosDaPessoa(m, pessoa.id).map((d) => d.pedido),
        tipos,
        cal,
        tipoId: tipo.id,
        inicio: s.inicio,
        fim: s.fim,
      });
      const pedido = criarPedido(m, {
        pessoaId: pessoa.id,
        tipoId: tipo.id,
        inicio: s.inicio,
        fim: s.fim,
        diasUteis: dias.length,
        diasDebitoPorAno: tipo.consomeSaldo ? sim.diasDebitoPorAno : {},
        diasOcupados: dias,
        motivoPrivado: s.motivoPrivado,
        excedeSaldo: tipo.consomeSaldo ? sim.excedeSaldo : false,
        prazoEm: s.status === "pendente" && prazoHoras ? somarHoras(s.criadoEm, prazoHoras) : undefined,
        criadoEm: s.criadoEm,
        origem: "seed",
      });
      criados += 1;

      if (s.status === "pendente") {
        if (pessoa.id === "ana") {
          // A dona do pedido do pitch ja ve a etapa "Com seu gestor".
          const texto = textoDaEtapa(etapas.find((e) => e.chave === "com_gestor"), pedido, pessoa, tipo);
          gravarNotificacao(m, { pessoaId: pessoa.id, pedidoId: pedido.id, etapa: "com_gestor", texto, criadaEm: s.criadoEm });
        }
        continue;
      }

      const decididoEm = somarHoras(s.criadoEm, 5);
      decidirPedido(m, {
        pedidoId: pedido.id,
        versao: pedido.versao,
        decisao: s.status === "aprovada" ? "aprovar" : "recusar",
        decididoPor: s.decididoPor as string,
        decididoEm,
        motivoDecisao: s.motivoDecisao,
        sugestao: s.sugestao,
      });
      if (s.status === "aprovada") {
        // O job `adicionar` acabou de ser enfileirado: o resultado e o do cenario.
        const job = tomarProximoJob(m, decididoEm, somarHoras(decididoEm, 1), pedido.id);
        if (job) {
          if (s.sync === "falha") {
            esgotarJob(m, job.id, "Portal de demonstração indisponível (simulado).", decididoEm, 3);
          } else {
            const dono = obterPessoa(m, pessoa.id);
            concluirJob(m, job.id, decididoEm, { bitrixEventId: `demo-${pedido.id}`, ownerId: dono?.bitrixUserId });
          }
        }
      }
    }
  });
  return { executado: criados > 0, pedidos: criados };
}
