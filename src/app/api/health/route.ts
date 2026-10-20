/**
 * Healthcheck: usado pela Onnira Cloud AI e por monitoramento.
 * Nao exige configuracao e nao expõe dado algum do cliente.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    servico: "aplicativo-br24",
    horario: new Date().toISOString(),
  });
}
