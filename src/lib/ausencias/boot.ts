/**
 * Boot de Ferias e Ausencias: relogio, portal e preparo do modo demonstracao.
 *
 *  - `MODO_DEMO=1` so convive com portal ficticio (`demo:*`) ou portal REAL
 *    marcado como teste (`portal_setting teste=1`). Qualquer outro portal real =>
 *    o app RECUSA subir (erro explicito em `verificarPortaisParaDemo`).
 *  - Com MODO_DEMO=1, `prepararDemo` roda o seed idempotente do C2 (portal
 *    `demo:ficticio`) e os pedidos de demonstracao. Seguro a cada boot.
 *  - Relogio: em demonstracao a data e FIXA (DEMO_HOJE ou 2026-10-26) para a
 *    demo nao envelhecer; o horario e o real. Fora da demonstracao, relogio real
 *    (horario de Brasilia).
 */
import { AppError } from "@/lib/errors";
import { portalAtivo } from "@/lib/db/portals";
import { conexao } from "./repo/base";
import { semearDemo, PORTAL_DEMO } from "./seed";
import { hojeDemo, semearPedidosDemo } from "./seed-demo-pedidos";
import type { DataISO, Relogio } from "./tipos";

export { PORTAL_DEMO };

export function modoDemo(): boolean {
  return process.env.MODO_DEMO === "1";
}

/** Recusa subir com MODO_DEMO=1 se houver portal real que nao seja de teste. */
export function verificarPortaisParaDemo(): void {
  if (!modoDemo()) return;
  const reais = conexao()
    .prepare(
      `SELECT COUNT(*) AS n FROM portal p
        WHERE p.member_id NOT LIKE 'demo:%'
          AND NOT EXISTS (SELECT 1 FROM portal_setting s
                           WHERE s.member_id = p.member_id AND s.key = 'teste' AND s.value = '1')`,
    )
    .get() as { n: number };
  if (reais.n > 0) {
    throw new Error(
      "MODO_DEMO=1 recusado: existe portal real que nao esta marcado como teste (portal_setting teste=1). " +
        "Desligue o modo demonstracao ou marque o portal como teste.",
    );
  }
}

let preparado = false;

/** Seed idempotente do portal demo (so com MODO_DEMO=1). */
export function prepararDemo(): void {
  if (!modoDemo()) return;
  verificarPortaisParaDemo();
  if (preparado) return;
  semearDemo({ hoje: hojeDemo() });
  semearPedidosDemo({ hoje: hojeDemo() });
  preparado = true;
}

/** Para testes: forca novo seed na proxima chamada de `prepararDemo`. */
export function esquecerPreparoDemo(): void {
  preparado = false;
}

/** Tenant dos servicos: o portal demo em demonstracao; senao o portal ativo. */
export function portalDeAusencias(): string {
  if (modoDemo()) return PORTAL_DEMO;
  const portal = portalAtivo();
  if (!portal || portal.memberId.startsWith("demo:")) throw new AppError("SEM_CONFIGURACAO");
  return portal.memberId;
}

/**
 * Relogio da demonstracao: `hoje` e fixo (a demo nao envelhece) e `agora`
 * parte do dia da demo, na hora real do dia, e dai AVANCA de forma monotonica.
 * Antes ele reaproveitava so a hora do dia e voltava 24h na virada do dia UTC,
 * fazendo leases de sincronizacao parecerem nao vencidos.
 */
export function criarRelogioDemo(dia: DataISO, agoraReal: () => number = Date.now): Relogio {
  const realInicial = agoraReal();
  const inicio = Date.parse(`${dia}T00:00:00.000Z`) + (realInicial % 86_400_000);
  return {
    hoje: () => dia,
    agora: () => new Date(inicio + (agoraReal() - realInicial)).toISOString(),
  };
}

let relogioDemo: Relogio | null = null;

export function criarRelogio(): Relogio {
  if (modoDemo()) {
    const dia = hojeDemo();
    // `hoje` acompanha DEMO_HOJE a cada chamada; `agora` e um unico relogio por processo.
    relogioDemo ??= criarRelogioDemo(dia);
    const base = relogioDemo;
    return { hoje: () => hojeDemo(), agora: () => base.agora() };
  }
  const brasilia = () => new Date(Date.now() - 3 * 3_600_000).toISOString();
  return {
    hoje: () => brasilia().slice(0, 10),
    agora: () => new Date().toISOString(),
  };
}
