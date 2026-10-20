/**
 * Permissoes: o app nunca deve mostrar nem executar algo que o usuario nao
 * poderia fazer no proprio Bitrix24 (requisito explicito do desafio).
 *
 * Estrategia:
 *  1. o escopo concedido ao app limita o que e tecnicamente possivel;
 *  2. `user.admin` / `profile.ADMIN` separa administrador de usuario comum;
 *  3. para acoes de CRM, a verificacao final e sempre do proprio Bitrix: nos
 *     nao reimplementamos o modelo de permissao, apenas traduzimos o erro
 *     ACCESS_DENIED em mensagem clara e escondemos o que o escopo nao cobre.
 */
import { callRest } from "./client";
import { escoposConcedidos, usuarioAtual } from "./discovery";
import { comCache, TTL } from "@/lib/db/cache";
import { AppError } from "@/lib/errors";

export interface ContextoPermissao {
  usuarioId: string;
  nome: string;
  admin: boolean;
  escopos: string[];
}

export async function contextoPermissao(
  memberId: string,
): Promise<ContextoPermissao> {
  const [usuario, escopos, admin] = await Promise.all([
    usuarioAtual(memberId),
    escoposConcedidos(memberId),
    ehAdministrador(memberId),
  ]);

  return {
    usuarioId: usuario.dados.id,
    nome: usuario.dados.nome,
    admin,
    escopos: escopos.dados,
  };
}

async function ehAdministrador(memberId: string): Promise<boolean> {
  const r = await comCache(memberId, "user:admin", TTL.cadastros, async () => {
    try {
      const resposta = await callRest<boolean>(memberId, "user.admin");
      return Boolean(resposta.result);
    } catch {
      // Metodo indisponivel no portal: cai para a flag do perfil.
      const perfil = await usuarioAtual(memberId);
      return perfil.dados.admin;
    }
  });
  return r.dados;
}

export function temEscopo(ctx: ContextoPermissao, escopo: string): boolean {
  return ctx.escopos.includes(escopo);
}

/** Barra a operacao quando o escopo necessario nao foi concedido. */
export function exigirEscopo(ctx: ContextoPermissao, escopo: string): void {
  if (!temEscopo(ctx, escopo)) {
    throw new AppError("SEM_PERMISSAO", {
      tecnico: `Escopo ausente: ${escopo}`,
      detalhe: { escopoNecessario: escopo },
    });
  }
}

/** Barra a operacao quando ela exige administrador do portal. */
export function exigirAdmin(ctx: ContextoPermissao): void {
  if (!ctx.admin) {
    throw new AppError("SEM_PERMISSAO", {
      tecnico: `Usuario ${ctx.usuarioId} nao e administrador`,
    });
  }
}

/**
 * Para a UI: diz o que renderizar sem tentar a chamada.
 * Use isso para esconder botoes, em vez de deixar o usuario clicar e falhar.
 */
export function capacidades(ctx: ContextoPermissao) {
  return {
    verCrm: temEscopo(ctx, "crm"),
    escreverCrm: temEscopo(ctx, "crm"),
    verTarefas: temEscopo(ctx, "task"),
    verUsuarios: temEscopo(ctx, "user"),
    configurarApp: ctx.admin,
  };
}
