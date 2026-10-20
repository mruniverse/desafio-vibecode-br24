/**
 * Passo 1 do OAuth: recebe as credenciais do aplicativo local, guarda
 * (client_secret cifrado) e devolve a URL de autorizacao do portal.
 */
import { rota } from "@/lib/api";
import { iniciarOauth } from "@/lib/setup";

export const dynamic = "force-dynamic";

export async function POST(requisicao: Request) {
  return rota("api.setup.oauth.iniciar", async () => {
    const corpo = await requisicao.json().catch(() => ({}));
    return iniciarOauth(corpo);
  });
}
