/**
 * Sessao dos servicos de ausencias.
 *
 * O COOKIE (HMAC-SHA256, chave derivada de APP_ENCRYPTION_KEY) e emitido e
 * lido em `src/app/api/ausencias/_sessao.ts` (C4) e e REUSADO: nao ha segundo
 * mecanismo. Este modulo so garante a segunda metade da regra: o PAPEL vem do
 * BANCO, nunca do cookie nem do corpo. `SessaoDemo.papel` que chega aos
 * servicos e ignorado; a pessoa e o papel reais sao relidos a cada operacao.
 */
import { obterPessoa } from "./repo/catalogo";
import { ErroDominio } from "./erros";
import type { Papel, Pessoa, SessaoDemo } from "./tipos";

export interface SessaoResolvida {
  pessoa: Pessoa;
  /** Papel LIDO DO BANCO. */
  papel: Papel;
}

/** Pessoa e papel reais da sessao; pessoa desconhecida (cookie forjado) = SEM_PERMISSAO. */
export function resolverSessao(portalMemberId: string, sessao: SessaoDemo): SessaoResolvida {
  const pessoa =
    typeof sessao?.pessoaId === "string" && sessao.pessoaId.length > 0
      ? obterPessoa(portalMemberId, sessao.pessoaId)
      : null;
  if (!pessoa) throw new ErroDominio("SEM_PERMISSAO", "sessao de pessoa inexistente");
  return { pessoa, papel: pessoa.papel };
}
