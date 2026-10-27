/**
 * Ponto de entrada dos repositorios de Ausencias + adaptadores das portas
 * (`RepositorioAusencias`, `Notificador`) fixadas em ../portas.ts, ja presos a
 * um `portalMemberId`.
 */
import type { Notificador, RepositorioAusencias } from "../portas";
import type { Relogio, SessaoDemo } from "../tipos";
import { listarEquipes, listarEtapas, listarTipos, obterPessoa } from "./catalogo";
import { lancamentosDaPessoa } from "./lancamentos";
import { gravarNotificacao } from "./notificacoes";
import { listarPedidosVisiveis } from "./pedidos";

export * from "./base";
export * from "./catalogo";
export * from "./lancamentos";
export * from "./notificacoes";
export * from "./pedidos";
export * from "./sync";

/**
 * Implementacao SQLite de `RepositorioAusencias` para um portal.
 * `pessoa(sessao)` le pessoa e papel DO BANCO; o `papel` da sessao e ignorado.
 */
export function criarRepositorioAusencias(portalMemberId: string): RepositorioAusencias {
  return {
    pessoa: (sessao: SessaoDemo) => obterPessoa(portalMemberId, sessao.pessoaId),
    tipos: () => listarTipos(portalMemberId),
    equipes: () => listarEquipes(portalMemberId),
    etapas: () => listarEtapas(portalMemberId),
    pedidosVisiveis: (sessao: SessaoDemo) => listarPedidosVisiveis(portalMemberId, sessao),
    lancamentos: (pessoaId: string) => lancamentosDaPessoa(portalMemberId, pessoaId),
  };
}

/** `Notificador` que grava na caixa do app (unica por pessoa/pedido/etapa). */
export function criarNotificador(portalMemberId: string, relogio: Relogio): Notificador {
  return {
    gravar(pessoaId: string, pedidoId: number, etapa: string, texto: string): void {
      gravarNotificacao(portalMemberId, {
        pessoaId,
        pedidoId,
        etapa,
        texto,
        criadaEm: relogio.agora(),
      });
    },
  };
}
