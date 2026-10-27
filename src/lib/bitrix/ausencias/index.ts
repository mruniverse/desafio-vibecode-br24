/**
 * Porta Bitrix de ausencias: fabrica + reexports.
 *
 * Padrao: FAKE em memoria (rotulado "simulado"). A porta REAL so e escolhida
 * com `BITRIX_ESCRITA=1`; escolher a porta real NAO concede escrita: cada
 * escrita ainda passa pelo gate fail-closed do `BitrixReal` (confirmacao de
 * portal de teste via `real.portalDeTeste`). Leitura
 * no portal real continua liberada.
 */
import type { PortaBitrix } from "../../ausencias/portas";
import { BitrixReal } from "./real";
import type { OpcoesBitrixReal } from "./real";
import { FakeBitrix } from "./fake";

export type PortaBitrixRotulada = PortaBitrix & { readonly modo: "simulado" | "real" };

export interface OpcoesEscolherPorta {
  /** Ambiente (default `process.env`). */
  env?: Record<string, string | undefined>;
  /** Opcoes repassadas ao BitrixReal quando for escolhido. */
  real?: OpcoesBitrixReal;
  /** Fake a usar (default: instancia compartilhada do processo). */
  fake?: FakeBitrix;
}

let fakeCompartilhado: FakeBitrix | null = null;

/** Fake unico do processo: o estado simulado sobrevive entre requisicoes. */
export function fakeDoProcesso(): FakeBitrix {
  if (!fakeCompartilhado) fakeCompartilhado = new FakeBitrix();
  return fakeCompartilhado;
}

export function escolherPorta(opcoes: OpcoesEscolherPorta = {}): PortaBitrixRotulada {
  const env = opcoes.env ?? process.env;
  if (env.BITRIX_ESCRITA === "1") {
    return new BitrixReal({ ...opcoes.real, env });
  }
  return opcoes.fake ?? fakeDoProcesso();
}

export { FakeBitrix, ROTULO_BITRIX_SIMULADO } from "./fake";
export type { FalhasInjetaveis, EventoGuardado, ChamadaRegistrada, Notificacao } from "./fake";
export { BitrixReal, converterCalendario } from "./real";
export type { ChamadaRest, OpcoesBitrixReal } from "./real";
export { executarSincronizacao, MAX_TENTATIVAS_SINCRONIZACAO } from "./executor";
export type { JobSincronizacao, ResultadoSincronizacao, OpcoesExecutor } from "./executor";
export { ErroPortaBitrix, sanitizarMensagem } from "./erros";
export type { CodigoErroBitrix } from "./erros";
export { escaparBBCode, montarMarcador } from "./util";
