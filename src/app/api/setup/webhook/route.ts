/**
 * Conecta o portal por webhook de entrada.
 * A URL e validada contra o portal real antes de ser persistida (cifrada).
 */
import { rota } from "@/lib/api";
import { conectarPorWebhook } from "@/lib/setup";

export const dynamic = "force-dynamic";

export async function POST(requisicao: Request) {
  return rota("api.setup.webhook", async () => {
    const corpo = await requisicao.json().catch(() => ({}));
    return conectarPorWebhook(corpo);
  });
}
