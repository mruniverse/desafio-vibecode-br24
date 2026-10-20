/**
 * Estado da configuracao inicial.
 * Consumido pelo wizard para saber em que etapa continuar.
 */
import { rota } from "@/lib/api";
import { estadoConfiguracao, urlRedirecionamento } from "@/lib/setup";
import { envStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return rota("api.setup.estado", async () => ({
    ...estadoConfiguracao(),
    redirectUri: urlRedirecionamento(),
    ambiente: envStatus(),
  }));
}
