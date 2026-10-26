/** Dados fictícios compartilhados por C1, C2, C3 e C4 (nenhum dado real). */
import type { Equipe, Pessoa, Tipo } from "../../src/lib/ausencias/tipos.ts";

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

export const EQUIPE_TEC: Equipe = { id: "tec", nome: "Tecnologia", gestorId: "carlos", minimoPessoas: 5, contarPendentes: false };

export const PESSOAS_TEC: Pessoa[] = [
  { id: "ana", nome: "Ana Ribeiro", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "bruno", nome: "Bruno Teixeira", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "camila", nome: "Camila Nogueira", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Back-end" },
  { id: "diego", nome: "Diego Martins", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Front-end" },
  { id: "elisa", nome: "Elisa Prado", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "QA" },
  { id: "felipe", nome: "Felipe Araújo", equipeId: "tec", papel: "colaborador", aprovadorId: "carlos", funcao: "Front-end" },
  { id: "carlos", nome: "Carlos Mendes", equipeId: "tec", papel: "gestor", aprovadorId: "renata", funcao: "Gestão" },
];

export const ADMINS: Pessoa[] = [
  { id: "marina", nome: "Marina Lopes", equipeId: "people", papel: "admin", aprovadorId: "paulo", funcao: "People" },
  { id: "paulo", nome: "Paulo Dias", equipeId: "people", papel: "admin", aprovadorId: "marina", funcao: "People" },
];

/** Data fixa de demonstração: a demo não envelhece (BR24-005). */
export const HOJE_DEMO = "2026-10-26";
