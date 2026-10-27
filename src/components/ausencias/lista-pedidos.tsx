"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Tipo } from "@/lib/ausencias/tipos";
import type { PedidoVisao } from "@/lib/ausencias/visoes";
import { periodo, plural, statusDoPedido } from "./formatos";
import { BotaoCancelar } from "./trilho-pedido";

type VarianteLink = "primary" | "secondary" | "ghost";

const BASE =
  "inline-flex h-11 min-h-11 select-none items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-150";
const VARIANTES: Record<VarianteLink, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
  secondary: "border border-line-strong bg-card text-strong shadow-sm hover:bg-muted",
  ghost: "bg-transparent text-body hover:bg-muted hover:text-strong",
};

/** <Link> com a aparência de <Button> (o Button do ui não vira link). */
export function LinkBotao({
  href,
  variante = "primary",
  className,
  children,
}: {
  href: string;
  variante?: VarianteLink;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(BASE, VARIANTES[variante], className)}>
      {children}
    </Link>
  );
}

function hrefPedirNessaData(p: PedidoVisao, tipos: Tipo[]): string | null {
  if (!p.sugestao) return null;
  const params = new URLSearchParams({ inicio: p.sugestao.inicio, fim: p.sugestao.fim });
  const tipo = tipos.find((t) => t.nome === p.tipo);
  if (tipo) params.set("tipo", tipo.id);
  return `/ausencias/pedir?${params.toString()}`;
}

export function ListaPedidos({
  pedidos,
  hoje,
  tipos,
  onCancelado,
}: {
  pedidos: PedidoVisao[];
  hoje: string;
  tipos: Tipo[];
  onCancelado: () => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {pedidos.map((p) => {
        const status = statusDoPedido(p.status, p.fim, hoje);
        const href = hrefPedirNessaData(p, tipos);
        return (
          <li key={p.id} className="flex flex-col gap-2 px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-strong">{p.tipo}</p>
                <p className="mt-0.5 text-sm text-body">
                  {periodo(p.inicio, p.fim)} · {plural(p.diasUteis, "dia útil", "dias úteis")}
                </p>
              </div>
              <Badge tom={status.tom} pontinho tamanho="md" className="shrink-0">
                {status.rotulo}
              </Badge>
            </div>
            {p.status === "recusada" ? (
              <div className="flex flex-col gap-2 rounded-md bg-danger-50 px-3 py-2.5">
                {p.motivoDecisao ? (
                  <p className="text-sm text-body">
                    <span className="font-semibold text-danger-700">Motivo da recusa: </span>
                    {p.motivoDecisao}
                  </p>
                ) : null}
                {p.sugestao && href ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-body">
                      Seu gestor sugeriu {periodo(p.sugestao.inicio, p.sugestao.fim)}.
                    </p>
                    <LinkBotao href={href} variante="secondary" className="shrink-0">
                      Pedir nessa data
                    </LinkBotao>
                  </div>
                ) : null}
              </div>
            ) : null}
            {p.permitido.cancelar ? (
              <div className="pt-1">
                <BotaoCancelar pedido={p} onCancelado={onCancelado} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
