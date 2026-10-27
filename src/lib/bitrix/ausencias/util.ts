/**
 * Utilitarios compartilhados pelo fake e pelo adaptador real.
 * Puro: sem rede, sem banco, sem logger.
 */
import { ErroPortaBitrix } from "./erros";

const RE_MARCADOR = /^\[BR24:[1-9]\d*\]$/;
const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Marcador gravado na `description` do evento: unico dado do pedido enviado ao Bitrix. */
export function montarMarcador(pedidoId: number): string {
  if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) {
    throw new ErroPortaBitrix("ENTRADA_INVALIDA", "pedidoId invalido");
  }
  return `[BR24:${pedidoId}]`;
}

export function marcadorValido(marcador: string): boolean {
  return RE_MARCADOR.test(marcador);
}

export function exigirMarcador(marcador: string): void {
  if (!marcadorValido(marcador)) {
    throw new ErroPortaBitrix("ENTRADA_INVALIDA", "marcador fora do formato [BR24:<id>]");
  }
}

export function dataISOValida(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const m = RE_DATA.exec(valor);
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= diasNoMes(ano, mes);
}

export function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    return bissexto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

export function exigirIntervalo(inicio: string, fim: string): void {
  if (!dataISOValida(inicio) || !dataISOValida(fim)) {
    throw new ErroPortaBitrix("ENTRADA_INVALIDA", "data fora do formato AAAA-MM-DD");
  }
  if (inicio > fim) {
    throw new ErroPortaBitrix("ENTRADA_INVALIDA", "inicio posterior ao fim");
  }
}

export function exigirInteiroPositivo(valor: number, nome: string): void {
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new ErroPortaBitrix("ENTRADA_INVALIDA", `${nome} deve ser inteiro positivo`);
  }
}

const COLCHETE_ABRE = "\uFF3B"; // ［
const COLCHETE_FECHA = "\uFF3D"; // ］
const TAMANHO_MAXIMO_NOTIFICACAO = 1000;

/**
 * Escapa BBCode de uma mensagem para `im.notify.system.add`.
 * O BBCode do Bitrix nao tem caractere de escape: troca `[` e `]` pelos
 * colchetes de largura total, que nenhum parser reconhece como tag
 * (`[URL=...]`, `[B]`, `[USER=...]` viram texto). Remove tambem caracteres de
 * controle (exceto quebra de linha) e limita o tamanho.
 */
export function escaparBBCode(mensagem: string): string {
  return String(mensagem)
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .replace(/\[/g, COLCHETE_ABRE)
    .replace(/\]/g, COLCHETE_FECHA)
    .slice(0, TAMANHO_MAXIMO_NOTIFICACAO);
}
