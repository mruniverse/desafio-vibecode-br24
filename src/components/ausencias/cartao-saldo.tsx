"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";
import type { Carteira } from "@/lib/ausencias/tipos";
import type { SaldoVisao } from "@/lib/ausencias/visoes";
import { dataCurta, plural } from "./formatos";

const ROTULO: Record<Carteira, string> = { ferias: "Férias disponíveis", folga: "Folgas disponíveis" };
const ORDEM: Carteira[] = ["ferias", "folga"];

export function CartaoSaldo({ saldos }: { saldos: SaldoVisao[] }) {
  const ordenados = ORDEM.map((c) => saldos.find((s) => s.carteira === c)).filter((s): s is SaldoVisao => s !== undefined);
  return (
    <Card>
      <CardHeader nivel="h2" titulo="Seu saldo" descricao="Em dias úteis (sem fins de semana e feriados)." />
      <CardBody>
        {ordenados.length === 0 ? (
          <p className="text-sm text-soft">Você ainda não tem saldo cadastrado.</p>
        ) : (
          <dl className="flex flex-col gap-4">
            {ordenados.map((s) => (
              <div key={s.carteira}>
                <dt className="text-sm text-soft">{ROTULO[s.carteira]}</dt>
                <dd className="mt-0.5 text-xl font-semibold text-strong">{plural(s.disponivel, "dia útil", "dias úteis")}</dd>
                {s.vencendo ? (
                  <dd className="mt-1.5 rounded-sm bg-warning-50 px-2 py-1 text-sm font-medium text-warning-700">
                    {plural(s.vencendo.dias, "dia vence", "dias vencem")} em {dataCurta(s.vencendo.venceEm)}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}
