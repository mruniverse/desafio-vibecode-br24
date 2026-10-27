/**
 * Mensagens das etapas (notificacoes) — PURO.
 *
 * Variaveis da whitelist: {nome} {periodo} {tipoPublico} {prazo}. Qualquer
 * outra chave vira texto vazio (a whitelist ja barra na edicao; aqui e a 2a
 * barreira). O texto NUNCA recebe justificativa, motivoPrivado nem motivoDecisao,
 * e o tipo sensivel sai como ROTULO_PUBLICO_SENSIVEL.
 *
 * O texto e puro (a caixa do app o exibe como texto). Para o Bitrix o BBCode e
 * escapado na porta (`escaparBBCode`), de novo aqui por defesa em profundidade.
 */
import { ROTULO_PUBLICO_SENSIVEL } from "./tipos";
import type { DataISO, Etapa, InstanteISO, Pedido, Pessoa, Tipo } from "./tipos";

export function curto(d: DataISO): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

export function periodoCurto(inicio: DataISO, fim: DataISO): string {
  return inicio === fim ? curto(inicio) : `${curto(inicio)} a ${curto(fim)}`;
}

export function rotuloPublicoDoTipo(tipo: Pick<Tipo, "nome" | "sensivel">): string {
  return tipo.sensivel ? ROTULO_PUBLICO_SENSIVEL : tipo.nome;
}

export function prazoTexto(prazoEm: InstanteISO | undefined): string {
  return prazoEm ? `${curto(prazoEm.slice(0, 10))} às ${prazoEm.slice(11, 16)}` : "sem prazo";
}

export function renderizar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{([^}]*)\}/g, (_m, chave: string) => vars[chave] ?? "");
}

export function textoDaEtapa(
  etapa: Pick<Etapa, "mensagem"> | undefined,
  pedido: Pick<Pedido, "inicio" | "fim" | "prazoEm">,
  pessoa: Pick<Pessoa, "nome">,
  tipo: Pick<Tipo, "nome" | "sensivel">,
): string {
  return renderizar(etapa?.mensagem ?? "", {
    nome: pessoa.nome,
    periodo: periodoCurto(pedido.inicio, pedido.fim),
    tipoPublico: rotuloPublicoDoTipo(tipo),
    prazo: prazoTexto(pedido.prazoEm),
  });
}
