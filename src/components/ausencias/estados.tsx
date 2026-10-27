"use client";

/**
 * Os quatro estados de toda tela de ausências:
 *  - carregando -> <Carregando/>      (esqueleto, aria-busy)
 *  - vazio      -> <Vazio/>           (explica e oferece o próximo passo)
 *  - erro       -> <ErroTela/>        (mensagem em português + "Tentar de novo")
 *  - sucesso    -> <Sucesso/> ou toast depois de uma ação
 * `EstadoDaTela` decide entre os três primeiros a partir de `EstadoCarga`.
 */
import * as React from "react";
import { Alert, Button, Card, CardBody, EmptyState, Skeleton, SkeletonText } from "@/components/ui";
import type { ErroApi } from "./api";
import type { EstadoCarga } from "./use-carregar";

export function Carregando({ rotulo = "Carregando…", linhas = 3 }: { rotulo?: string; linhas?: number }) {
  return (
    <Card aria-busy="true" aria-live="polite">
      <CardBody className="flex flex-col gap-4">
        <span className="sr-only">{rotulo}</span>
        <Skeleton altura="1.25rem" largura="40%" />
        <SkeletonText linhas={linhas} />
        <Skeleton altura="3rem" />
      </CardBody>
    </Card>
  );
}

export function ErroTela({ erro, onTentarDeNovo }: { erro: ErroApi; onTentarDeNovo?: () => void }) {
  return (
    <Alert
      tipo="erro"
      titulo="Não foi possível carregar esta tela"
      acao={
        onTentarDeNovo ? (
          <Button variante="secondary" tamanho="sm" onClick={onTentarDeNovo}>
            Tentar de novo
          </Button>
        ) : undefined
      }
    >
      {erro.mensagem}
    </Alert>
  );
}

export function Vazio({
  titulo,
  descricao,
  acao,
  icone,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  acao?: React.ReactNode;
  icone?: React.ReactNode;
}) {
  return (
    <Card>
      <EmptyState titulo={titulo} descricao={descricao} acao={acao} icone={icone} />
    </Card>
  );
}

export function Sucesso({
  titulo,
  children,
  acao,
}: {
  titulo: string;
  children?: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <Alert tipo="sucesso" titulo={titulo} acao={acao}>
      {children}
    </Alert>
  );
}

export interface EstadoDaTelaProps<T> {
  estado: EstadoCarga<T>;
  onTentarDeNovo?: () => void;
  /** Quando devolve true, mostra o estado vazio em vez do conteúdo. */
  vazio?: (dados: T) => boolean;
  renderVazio?: () => React.ReactNode;
  rotuloCarregando?: string;
  children: (dados: T) => React.ReactNode;
}

export function EstadoDaTela<T>({
  estado,
  onTentarDeNovo,
  vazio,
  renderVazio,
  rotuloCarregando,
  children,
}: EstadoDaTelaProps<T>) {
  if (estado.status === "carregando") return <Carregando rotulo={rotuloCarregando} />;
  if (estado.status === "erro") return <ErroTela erro={estado.erro} onTentarDeNovo={onTentarDeNovo} />;
  if (vazio?.(estado.dados) && renderVazio) return <>{renderVazio()}</>;
  return <>{children(estado.dados)}</>;
}
