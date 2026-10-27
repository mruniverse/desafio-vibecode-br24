/**
 * `melhorJanela` (BR24-005 v2.2, item 13): ate 3 janelas de `n` dias uteis
 * consecutivos nos proximos 180 dias (de amanha ate hoje+180, inclusive) em que
 * o minimo de pessoas trabalhando da equipe e respeitado em TODOS os dias
 * (`min(trabalhando) >= minimoPessoas`). Ordem: maior `min(trabalhando)`, depois
 * inicio mais cedo.
 *
 * "Consecutivos" = dias uteis seguidos: uma janela pode atravessar fim de
 * semana/feriado (inicio e fim sao o primeiro e o ultimo dia util). Janelas se
 * deslizam de um dia util em um, entao as 3 melhores podem ser vizinhas.
 *
 * Quem pede: com `pessoaId`, o solicitante conta como ausente hipotetico
 * (`trabalhando - 1`) e janelas que colidem com um pedido pendente|aprovada dele
 * sao descartadas. Para "Sugerir outra data" (gestor), tire da lista o proprio
 * pedido em decisao, senao ele reduz a cobertura das datas originais.
 */
import { somarDias, validarData, type DataISO } from "./datas";
import { ErroDominio } from "./erros";
import { membrosDaEquipe, pessoasTrabalhandoPorDia, verificarSobreposicao, type EntradaCobertura } from "./cobertura";

export const JANELA_HORIZONTE_DIAS = 180;
export const JANELA_MAX_RESULTADOS = 3;

export interface EntradaJanela extends Omit<EntradaCobertura, "de" | "ate"> {
  /** Dias uteis da janela, inteiro de 1 a JANELA_HORIZONTE_DIAS. */
  n: number;
  hoje: DataISO;
  /** Solicitante (opcional): ver nota do modulo. */
  pessoaId?: string;
}

export interface Janela {
  inicio: DataISO;
  fim: DataISO;
  /** Menor numero de pessoas trabalhando nos dias da janela (ja descontado o solicitante, se houver). */
  minTrabalhando: number;
  diasUteis: number;
}

export function melhorJanela(entrada: EntradaJanela): Janela[] {
  const { n } = entrada;
  if (!Number.isInteger(n) || n < 1 || n > JANELA_HORIZONTE_DIAS) {
    throw new ErroDominio("NUMERO_INVALIDO", `n deve ser inteiro entre 1 e ${JANELA_HORIZONTE_DIAS}`);
  }
  const hoje = validarData(entrada.hoje, "hoje");
  const solicitante = entrada.pessoaId;
  if (solicitante !== undefined && !membrosDaEquipe(entrada.equipe, entrada.pessoas).some((m) => m.id === solicitante)) {
    throw new ErroDominio("NAO_ENCONTRADO", "solicitante nao pertence a equipe");
  }
  const desconto = solicitante === undefined ? 0 : 1;

  const uteis = pessoasTrabalhandoPorDia({
    ...entrada,
    de: somarDias(hoje, 1),
    ate: somarDias(hoje, JANELA_HORIZONTE_DIAS),
  }).filter((d) => d.util);

  const candidatas: Janela[] = [];
  for (let i = 0; i + n <= uteis.length; i++) {
    const dias = uteis.slice(i, i + n);
    const minimo = Math.min(...dias.map((d) => d.trabalhando)) - desconto;
    if (minimo < entrada.equipe.minimoPessoas) continue;
    const inicio = dias[0].data;
    const fim = dias[n - 1].data;
    if (solicitante !== undefined && colide(entrada, solicitante, inicio, fim)) continue;
    candidatas.push({ inicio, fim, minTrabalhando: minimo, diasUteis: n });
  }
  candidatas.sort((a, b) => b.minTrabalhando - a.minTrabalhando || (a.inicio < b.inicio ? -1 : 1));
  return candidatas.slice(0, JANELA_MAX_RESULTADOS);
}

function colide(entrada: EntradaJanela, pessoaId: string, inicio: DataISO, fim: DataISO): boolean {
  try {
    verificarSobreposicao({
      pedidos: entrada.pedidos.map((p, i) => ({ ...p, id: i })),
      pessoaId,
      inicio,
      fim,
      cal: entrada.cal,
    });
    return false;
  } catch (e) {
    if (e instanceof ErroDominio && e.subcodigo === "SOBREPOSICAO") return true;
    throw e;
  }
}
