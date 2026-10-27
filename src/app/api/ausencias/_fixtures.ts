/**
 * Dados FICTICIOS do provedor em memoria (C4). Copiados de
 * tests/_helpers/fixtures.ts e ampliados com as demais equipes do prototipo.
 * Nenhum dado real. Sai de cena quando o C2 trocar `_servicos.ts`.
 */
import type { Equipe, Etapa, Pessoa, Tipo } from "@/lib/ausencias/tipos";

/** Data fixa de demonstracao: a demo nao envelhece (BR24-005). */
export const HOJE_DEMO = "2026-10-26";

export const TIPOS: Tipo[] = [
  { id: "ferias", nome: "Férias anuais", quemPede: "todos", consomeSaldo: "ferias", sensivel: false, cor: "#B9DB6B" },
  { id: "folga", nome: "Folga", quemPede: "todos", consomeSaldo: "folga", sensivel: false, cor: "#7FD3C7" },
  { id: "outro", nome: "Outro", quemPede: "todos", consomeSaldo: null, sensivel: false, cor: "#7FD3C7" },
  { id: "viagem", nome: "Viagem de negócios", quemPede: "todos", consomeSaldo: null, sensivel: false, cor: "#E3A8D6" },
  { id: "doenca", nome: "Licença por doença", quemPede: "todos", consomeSaldo: null, sensivel: true, cor: "#F2A27E" },
  { id: "maternidade", nome: "Licença de maternidade", quemPede: "todos", consomeSaldo: null, sensivel: true, cor: "#A9C4F5" },
  { id: "sem-vencimento", nome: "Licença sem vencimento", quemPede: "todos", consomeSaldo: null, sensivel: false, cor: "#C3C9D2" },
  { id: "sem-permissao", nome: "Ausência sem permissão", quemPede: "admin", consomeSaldo: null, sensivel: false, cor: "#F09A91" },
];

export const EQUIPES: Equipe[] = [
  { id: "tec", nome: "Tecnologia", gestorId: "carlos", minimoPessoas: 5, contarPendentes: false },
  { id: "produto", nome: "Produto", gestorId: "rafael", minimoPessoas: 2, contarPendentes: false },
  { id: "comercial", nome: "Comercial", gestorId: "vinicius", minimoPessoas: 3, contarPendentes: false },
  { id: "lideranca", nome: "Liderança", gestorId: "renata", minimoPessoas: 1, contarPendentes: false },
  { id: "people", nome: "People", gestorId: "marina", minimoPessoas: 1, contarPendentes: false },
];

export const PESSOAS: Pessoa[] = [
  { id: "ana", nome: "Ana Ribeiro", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "bruno", nome: "Bruno Teixeira", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "camila", nome: "Camila Nogueira", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "diego", nome: "Diego Martins", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Front-end" },
  { id: "elisa", nome: "Elisa Prado", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "QA" },
  { id: "felipe", nome: "Felipe Araújo", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Front-end" },
  { id: "carlos", nome: "Carlos Mendes", equipeId: "tec", papel: "gestor", aprovadorId: "renata", funcao: "Gestão" },
  { id: "rafael", nome: "Rafael Souza", equipeId: "produto", papel: "gestor", aprovadorId: "renata", funcao: "Gestão" },
  { id: "paula", nome: "Paula Freitas", equipeId: "produto", papel: "colaborador", aprovadorId: "rafael", funcao: "Design" },
  { id: "lucas", nome: "Lucas Pereira", equipeId: "produto", papel: "colaborador", aprovadorId: "rafael", funcao: "Produto" },
  { id: "vinicius", nome: "Vinícius Alves", equipeId: "comercial", papel: "gestor", aprovadorId: "renata", funcao: "Gestão" },
  { id: "gabriel", nome: "Gabriel Costa", equipeId: "comercial", papel: "colaborador", aprovadorId: "vinicius", funcao: "Vendas" },
  { id: "helena", nome: "Helena Rocha", equipeId: "comercial", papel: "colaborador", aprovadorId: "vinicius", funcao: "Vendas" },
  { id: "igor", nome: "Igor Santos", equipeId: "comercial", papel: "colaborador", aprovadorId: "vinicius", funcao: "Pré-vendas" },
  { id: "renata", nome: "Renata Alves", equipeId: "lideranca", papel: "gestor", aprovadorId: "paulo", funcao: "Diretoria" },
  { id: "marina", nome: "Marina Lopes", equipeId: "people", papel: "admin", aprovadorId: "paulo", funcao: "People" },
  { id: "paulo", nome: "Paulo Dias", equipeId: "people", papel: "admin", aprovadorId: "marina", funcao: "People" },
];

/** Etapas fixas (BR24-005 v2.2): variaveis so {nome} {periodo} {tipoPublico} {prazo}. */
export const ETAPAS: Etapa[] = [
  { chave: "enviado", rotulo: "Enviado", mensagem: "Pedido de {nome} enviado: {tipoPublico}, {periodo}." },
  {
    chave: "com_gestor",
    rotulo: "Com seu gestor",
    mensagem: "{nome}, seu pedido de {tipoPublico} ({periodo}) está com o gestor. Resposta até {prazo}.",
    prazoHoras: 48,
  },
  { chave: "confirmado", rotulo: "Confirmado", mensagem: "{nome}, seu pedido de {tipoPublico} ({periodo}) foi confirmado." },
  { chave: "recusado", rotulo: "Recusado", mensagem: "{nome}, seu pedido de {tipoPublico} ({periodo}) não foi aprovado. Veja o motivo no app." },
];

/** Feriados nacionais fixos (MM-DD) usados no calendario de demonstracao. */
export const FERIADOS_FIXOS: string[] = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
