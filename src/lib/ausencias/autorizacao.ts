/**
 * Autorizacao de Ferias e Ausencias (BR24-005 v2.2, "Matriz de autorizacao").
 *
 * Funcoes PURAS: recebem a pessoa (LIDA DO BANCO, nunca do cookie/corpo) e os
 * dados necessarios; nao tocam banco nem relogio. Negado e sempre `false`; quem
 * chama decide entre 403 (rota sem id) e 404 (recurso por id, sem pista).
 *
 * Regras:
 *  - ver: o proprio; admin (todos); gestor da equipe; aprovador designado.
 *  - decidir (aprovar/recusar/sugerir): so pedido PENDENTE, NUNCA o proprio.
 *    Admin decide qualquer outro pedido (inclusive de outro admin: "o proprio
 *    so por outro admin"); gestor so se for gestor da equipe da pessoa ou o
 *    aprovador designado dela.
 *  - cancelar: o proprio so antes do inicio (admin sempre); gestor/admin depois.
 *  - creditar: nunca a si; admin a todos; gestor so a quem e da equipe que gerencia.
 *  - equipe (calendario/disponibilidade/painel): gestor da equipe ou a propria; admin todas.
 */
import type { DataISO, Equipe, Pedido, Pessoa } from "./tipos";

type Pessoal = Pick<Pessoa, "id" | "papel" | "equipeId" | "aprovadorId">;

export function ehAdmin(eu: Pick<Pessoa, "papel">): boolean {
  return eu.papel === "admin";
}

/** `eu` e o gestor da equipe `equipeId`. */
export function gerenciaEquipe(eu: Pick<Pessoa, "id" | "papel">, equipeId: string, equipes: readonly Equipe[]): boolean {
  if (eu.papel !== "gestor") return false;
  return equipes.some((e) => e.id === equipeId && e.gestorId === eu.id);
}

/** `eu` e o aprovador designado de `alvo` (e tem papel para aprovar). */
export function ehAprovadorDesignado(eu: Pick<Pessoa, "id" | "papel">, alvo: Pick<Pessoa, "id" | "aprovadorId">): boolean {
  return eu.papel !== "colaborador" && alvo.id !== eu.id && alvo.aprovadorId === eu.id;
}

/** Superior de `alvo` para efeito de ver/decidir/cancelar: gestor da equipe ou aprovador designado. */
function ehSuperior(eu: Pessoal, alvo: Pessoal, equipes: readonly Equipe[]): boolean {
  if (eu.id === alvo.id) return false;
  return gerenciaEquipe(eu, alvo.equipeId, equipes) || ehAprovadorDesignado(eu, alvo);
}

export function podeVer(eu: Pessoal, alvo: Pessoal, equipes: readonly Equipe[]): boolean {
  if (eu.id === alvo.id) return true;
  if (ehAdmin(eu)) return true;
  return ehSuperior(eu, alvo, equipes);
}

export function podeDecidir(
  eu: Pessoal,
  alvo: Pessoal,
  pedido: Pick<Pedido, "status">,
  equipes: readonly Equipe[],
): boolean {
  if (pedido.status !== "pendente") return false;
  if (eu.id === alvo.id) return false; // nunca o proprio
  if (eu.papel === "colaborador") return false;
  if (ehAdmin(eu)) return true;
  return ehSuperior(eu, alvo, equipes);
}

export function podeCancelar(
  eu: Pessoal,
  alvo: Pessoal,
  pedido: Pick<Pedido, "status" | "inicio">,
  hoje: DataISO,
  equipes: readonly Equipe[],
): boolean {
  if (pedido.status !== "pendente" && pedido.status !== "aprovada") return false;
  if (eu.id === alvo.id) return ehAdmin(eu) || hoje < pedido.inicio;
  if (eu.papel === "colaborador") return false;
  if (ehAdmin(eu)) return true;
  return ehSuperior(eu, alvo, equipes);
}

export function podeCreditar(eu: Pessoal, alvo: Pessoal, equipes: readonly Equipe[]): boolean {
  if (eu.id === alvo.id) return false; // nunca a si mesmo
  if (ehAdmin(eu)) return true;
  return gerenciaEquipe(eu, alvo.equipeId, equipes);
}

/** Pode OLHAR a equipe (calendario, disponibilidade, painel). Colaborador nunca. */
export function podeVerEquipe(eu: Pessoal, equipe: Pick<Equipe, "id">, equipes: readonly Equipe[]): boolean {
  if (eu.papel === "colaborador") return false;
  if (ehAdmin(eu)) return true;
  return gerenciaEquipe(eu, equipe.id, equipes) || eu.equipeId === equipe.id;
}

/** Edita o minimo da equipe: admin ou o gestor DA equipe. */
export function podeEditarMinimo(eu: Pessoal, equipe: Pick<Equipe, "id">, equipes: readonly Equipe[]): boolean {
  if (ehAdmin(eu)) return true;
  return gerenciaEquipe(eu, equipe.id, equipes);
}

/** Impacto/grafico da equipe: so quem olha a equipe (nunca o colaborador, nem o dono). */
export function podeVerImpacto(eu: Pessoal, alvo: Pessoal, equipes: readonly Equipe[]): boolean {
  if (eu.papel === "colaborador") return false;
  return podeVer(eu, alvo, equipes);
}
