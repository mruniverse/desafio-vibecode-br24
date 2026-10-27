/**
 * Seed de demonstracao de Ferias e Ausencias (BR24-005 v2.1/v2.2).
 *
 * Regras:
 *  - So roda com MODO_DEMO=1 (desligado por padrao). Caso contrario nao faz nada.
 *  - Escreve APENAS no portal demo `demo:ficticio` (auth_mode WEBHOOK,
 *    webhook_url_enc NULL, setup_completed=0). Nunca toca portal real; se
 *    `demo:ficticio` existir com credencial/setup, recusa (algo o transformou
 *    em portal real).
 *  - Idempotente: chave natural + `ON CONFLICT DO NOTHING`, origem='seed'.
 *    Rodar 2x nao muda nenhuma contagem nem sobrescreve edicoes do admin.
 *  - Dados 100% ficticios (copiados de tests/_helpers/fixtures.ts; src nao
 *    importa de tests/). Datas relativas a `hoje` (padrao HOJE_DEMO).
 *
 * Saldo: 22 dias uteis de ferias e 5 de folga por pessoa, UM credito por
 * carteira com competencia no ano seguinte ao de `hoje` (2027 para a data
 * padrao, o periodo da demo) e vencimento em 31/12 desse ano.
 */
import { getEnv } from "@/lib/env";
import { etapaSchema } from "./schemas";
import type { Carteira, DataISO, Equipe, Etapa, Pessoa, Tipo } from "./tipos";
import { conexao, emTransacao } from "./repo/base";

export const PORTAL_DEMO = "demo:ficticio";
/** Data fixa de demonstracao: a demo nao envelhece. */
export const HOJE_DEMO: DataISO = "2026-10-26";
export const DIAS_FERIAS_SEED = 22;
export const DIAS_FOLGA_SEED = 5;

const TIPOS: Tipo[] = [
  { id: "ferias", nome: "Férias anuais", quemPede: "todos", consomeSaldo: "ferias", sensivel: false, cor: "#B9DB6B" },
  { id: "folga", nome: "Folga", quemPede: "todos", consomeSaldo: "folga", sensivel: false, cor: "#7FD3C7" },
  { id: "outro", nome: "Outro", quemPede: "todos", consomeSaldo: null, sensivel: false, cor: "#7FD3C7" },
  { id: "viagem", nome: "Viagem de negócios", quemPede: "todos", consomeSaldo: null, sensivel: false, cor: "#E3A8D6" },
  { id: "doenca", nome: "Licença por doença", quemPede: "todos", consomeSaldo: null, sensivel: true, cor: "#F2A27E" },
  { id: "maternidade", nome: "Licença de maternidade", quemPede: "todos", consomeSaldo: null, sensivel: true, cor: "#A9C4F5" },
  { id: "sem-vencimento", nome: "Licença sem vencimento", quemPede: "todos", consomeSaldo: null, sensivel: false, cor: "#C3C9D2" },
  { id: "sem-permissao", nome: "Ausência sem permissão", quemPede: "admin", consomeSaldo: null, sensivel: false, cor: "#F09A91" },
];

const EQUIPES: Equipe[] = [
  { id: "tec", nome: "Tecnologia", gestorId: "carlos", minimoPessoas: 5, contarPendentes: false },
  { id: "people", nome: "People", gestorId: "marina", minimoPessoas: 1, contarPendentes: false },
  { id: "direcao", nome: "Direção", gestorId: "renata", minimoPessoas: 1, contarPendentes: false },
];

const PESSOAS: Pessoa[] = [
  { id: "ana", nome: "Ana Ribeiro", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "bruno", nome: "Bruno Teixeira", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "camila", nome: "Camila Nogueira", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "diego", nome: "Diego Martins", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Front-end" },
  { id: "elisa", nome: "Elisa Prado", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "QA" },
  { id: "felipe", nome: "Felipe Araújo", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Front-end" },
  { id: "carlos", nome: "Carlos Mendes", equipeId: "tec", papel: "gestor", aprovadorId: "renata", funcao: "Gestão" },
  // Superior dos gestores (aprova os pedidos do Carlos).
  { id: "renata", nome: "Renata Souza", equipeId: "direcao", papel: "gestor", aprovadorId: "marina", funcao: "Direção" },
  // Dois admins: um aprova o outro (ninguem aprova nem credita para si).
  { id: "marina", nome: "Marina Lopes", equipeId: "people", papel: "admin", aprovadorId: "paulo", funcao: "People" },
  { id: "paulo", nome: "Paulo Dias", equipeId: "people", papel: "admin", aprovadorId: "marina", funcao: "People" },
];

/** So variaveis da whitelist: {nome} {periodo} {tipoPublico} {prazo}. */
const ETAPAS: Etapa[] = [
  { chave: "enviado", rotulo: "Enviado", mensagem: "Olá, {nome}! Seu pedido para {periodo} foi enviado." },
  {
    chave: "com_gestor",
    rotulo: "Com seu gestor",
    mensagem: "{nome}, seu pedido de {tipoPublico} para {periodo} está com o gestor. Resposta esperada até {prazo}.",
    prazoHoras: 48,
  },
  { chave: "confirmado", rotulo: "Confirmado", mensagem: "{nome}, seu pedido de {tipoPublico} para {periodo} foi confirmado." },
  {
    chave: "recusado",
    rotulo: "Recusado",
    mensagem: "{nome}, seu pedido de {tipoPublico} para {periodo} não foi aprovado. Veja o motivo no app.",
  },
];

export interface ResultadoSeed {
  executado: boolean;
  portal: string;
  /** Linhas realmente inseridas nesta chamada (0 na segunda execucao). */
  inseridos: { tipos: number; equipes: number; pessoas: number; lancamentos: number; etapas: number };
  motivo?: string;
}

function quemCredita(pessoaId: string): string {
  // Nunca a si mesmo: marina e creditada por paulo; os demais, por marina.
  return pessoaId === "marina" ? "paulo" : "marina";
}

/** Garante o portal demo ficticio, sem tocar em portal real. */
function garantirPortalDemo(): void {
  const db = conexao();
  db.prepare(
    `INSERT INTO portal (member_id, domain, client_endpoint, auth_mode, webhook_url_enc, setup_completed)
     VALUES (?, 'demo.invalid', 'https://demo.invalid/rest', 'WEBHOOK', NULL, 0)
     ON CONFLICT (member_id) DO NOTHING`,
  ).run(PORTAL_DEMO);

  const p = db
    .prepare(
      "SELECT auth_mode, webhook_url_enc, access_token_enc, setup_completed FROM portal WHERE member_id = ?",
    )
    .get(PORTAL_DEMO) as {
    auth_mode: string;
    webhook_url_enc: string | null;
    access_token_enc: string | null;
    setup_completed: number;
  };
  if (
    p.auth_mode !== "WEBHOOK" ||
    p.webhook_url_enc !== null ||
    p.access_token_enc !== null ||
    p.setup_completed !== 0
  ) {
    throw new Error(
      `Seed recusada: o portal ${PORTAL_DEMO} tem credencial ou setup concluido (nao e mais ficticio).`,
    );
  }
}

/**
 * Popula (ou completa) o portal demo. Seguro para chamar a cada boot.
 * `hoje` so afeta o ano/vencimento dos creditos.
 */
export function semearDemo(opcoes: { hoje?: DataISO } = {}): ResultadoSeed {
  const vazio = { tipos: 0, equipes: 0, pessoas: 0, lancamentos: 0, etapas: 0 };
  if (getEnv().MODO_DEMO !== "1") {
    return { executado: false, portal: PORTAL_DEMO, inseridos: vazio, motivo: "MODO_DEMO != 1" };
  }
  const hoje = opcoes.hoje ?? HOJE_DEMO;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error("hoje invalido (esperado YYYY-MM-DD)");
  const ano = Number(hoje.slice(0, 4)) + 1;
  const m = PORTAL_DEMO;
  const instante = `${hoje}T12:00:00.000Z`;

  // Valida as etapas com o schema oficial (whitelist de variaveis) antes de gravar.
  for (const e of ETAPAS) etapaSchema.parse(e);

  return emTransacao(() => {
    garantirPortalDemo();
    const db = conexao();
    const inseridos = { ...vazio };

    const insTipo = db.prepare(
      `INSERT INTO tipo (portal_member_id, id, nome, quem_pede, consome_saldo, sensivel, cor, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'seed') ON CONFLICT DO NOTHING`,
    );
    for (const t of TIPOS) {
      inseridos.tipos += insTipo.run(m, t.id, t.nome, t.quemPede, t.consomeSaldo, t.sensivel ? 1 : 0, t.cor).changes;
    }

    const insEquipe = db.prepare(
      `INSERT INTO equipe (portal_member_id, id, nome, gestor_id, minimo_pessoas, contar_pendentes, origem)
       VALUES (?, ?, ?, ?, ?, ?, 'seed') ON CONFLICT DO NOTHING`,
    );
    for (const e of EQUIPES) {
      inseridos.equipes += insEquipe.run(m, e.id, e.nome, e.gestorId, e.minimoPessoas, e.contarPendentes ? 1 : 0).changes;
    }

    const insPessoa = db.prepare(
      `INSERT INTO pessoa (portal_member_id, id, nome, equipe_id, papel, aprovador_id, funcao, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'seed') ON CONFLICT DO NOTHING`,
    );
    for (const p of PESSOAS) {
      inseridos.pessoas += insPessoa.run(m, p.id, p.nome, p.equipeId, p.papel, p.aprovadorId, p.funcao ?? null).changes;
    }

    const insLanc = db.prepare(
      `INSERT INTO lancamento (portal_member_id, pessoa_id, ano, carteira, tipo, dias, motivo, vence_em,
                               criado_por, criado_em, origem, chave_natural)
       VALUES (?, ?, ?, ?, 'credito', ?, 'Saldo inicial da demonstração (dados fictícios)', ?, ?, ?, 'seed', ?)
       ON CONFLICT DO NOTHING`,
    );
    const carteiras: { carteira: Carteira; dias: number }[] = [
      { carteira: "ferias", dias: DIAS_FERIAS_SEED },
      { carteira: "folga", dias: DIAS_FOLGA_SEED },
    ];
    for (const p of PESSOAS) {
      for (const c of carteiras) {
        inseridos.lancamentos += insLanc.run(
          m, p.id, ano, c.carteira, c.dias, `${ano}-12-31`, quemCredita(p.id), instante,
          `seed:${p.id}:${c.carteira}:${ano}`,
        ).changes;
      }
    }

    const insEtapa = db.prepare(
      `INSERT INTO etapa (portal_member_id, chave, rotulo, mensagem, prazo_horas, origem)
       VALUES (?, ?, ?, ?, ?, 'seed') ON CONFLICT DO NOTHING`,
    );
    for (const e of ETAPAS) {
      inseridos.etapas += insEtapa.run(m, e.chave, e.rotulo, e.mensagem, e.prazoHoras ?? null).changes;
    }

    return { executado: true, portal: m, inseridos };
  });
}
