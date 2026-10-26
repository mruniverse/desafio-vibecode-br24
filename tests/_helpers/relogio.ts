/** Relogio fixo para testes deterministicos (dominio puro nao usa Date.now). */
import type { Relogio } from "../../src/lib/ausencias/tipos.ts";

export function relogioFixo(hoje = "2026-10-26"): Relogio {
  return {
    hoje: () => hoje,
    agora: () => `${hoje}T12:00:00.000Z`,
  };
}
