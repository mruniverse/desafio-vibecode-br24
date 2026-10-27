"use client";

/**
 * Peças do "Pedido em andamento": trilho de etapas, cartão do pedido e o botão
 * "Cancelar pedido" com confirmação (usado também no histórico quando o servidor
 * permite cancelar um pedido já aprovado).
 */
import * as React from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Stepper, useToast } from "@/components/ui";
import type { Etapa } from "@/components/ui";
import type { ChaveEtapa } from "@/lib/ausencias/tipos";
import type { PedidoVisao } from "@/lib/ausencias/visoes";
import { api } from "./api";
import { dataCurta, periodo, plural, primeiroNome, statusDoPedido } from "./formatos";

const ETAPAS: Etapa[] = [
  { id: "enviado", titulo: "Enviado" },
  { id: "com_gestor", titulo: "Com seu gestor" },
  { id: "confirmado", titulo: "Confirmado" },
];

/** Trilho Enviado → Com seu gestor → Confirmado. Pedido recusado/cancelado não usa. */
export function TrilhoPedido({ etapa }: { etapa: ChaveEtapa }) {
  const indice = etapa === "confirmado" ? 2 : etapa === "com_gestor" ? 1 : 0;
  const concluidas = etapa === "confirmado" ? [0, 1, 2] : Array.from({ length: indice }, (_, i) => i);
  return <Stepper etapas={ETAPAS} atual={indice} concluidas={concluidas} rotulo="Andamento do pedido" />;
}

export function BotaoCancelar({
  pedido,
  onCancelado,
  rotulo = "Cancelar pedido",
}: {
  pedido: PedidoVisao;
  onCancelado: () => void;
  rotulo?: string;
}) {
  const toast = useToast();
  const [confirmando, setConfirmando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const gatilho = React.useRef<HTMLButtonElement>(null);
  const manter = React.useRef<HTMLButtonElement>(null);
  const mexeu = React.useRef(false);

  // Foco acompanha a troca: vai para "Manter pedido" ao abrir e volta ao gatilho ao fechar.
  React.useEffect(() => {
    if (confirmando) manter.current?.focus();
    else if (mexeu.current) gatilho.current?.focus();
  }, [confirmando]);

  async function confirmar() {
    setCancelando(true);
    setErro(null);
    const r = await api.cancelar(pedido.id);
    setCancelando(false);
    if (r.ok) {
      setConfirmando(false);
      toast.sucesso("Pedido cancelado", { descricao: `${pedido.tipo} (${periodo(pedido.inicio, pedido.fim)})` });
      onCancelado();
    } else {
      setErro(r.erro.mensagem);
    }
  }

  if (!confirmando) {
    return (
      <Button
        ref={gatilho}
        variante="secondary"
        onClick={() => {
          mexeu.current = true;
          setConfirmando(true);
        }}
      >
        {rotulo}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-muted p-4" role="group" aria-label="Confirmar cancelamento">
      <p className="text-sm font-semibold text-strong">Cancelar este pedido?</p>
      <p className="text-sm text-body">
        {pedido.tipo}, {periodo(pedido.inicio, pedido.fim)}. Essa ação não pode ser desfeita; para pedir de novo, você precisará fazer um novo pedido.
      </p>
      {erro ? <Alert tipo="erro">{erro}</Alert> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button ref={manter} variante="secondary" onClick={() => setConfirmando(false)} disabled={cancelando}>
          Manter pedido
        </Button>
        <Button variante="danger" onClick={confirmar} loading={cancelando}>
          Sim, cancelar pedido
        </Button>
      </div>
    </div>
  );
}

/** Texto do prazo. Compara datas com o "hoje" da demonstração (que é fixo). */
function textoPrazo(pedido: PedidoVisao, hoje: string): { texto: string; vencido: boolean } | null {
  if (!pedido.prazoEm) return null;
  const dia = pedido.prazoEm.slice(0, 10);
  const quem = pedido.aprovador ? primeiroNome(pedido.aprovador.nome) : "Seu gestor";
  if (dia < hoje) return { texto: `${quem} ainda não respondeu: o prazo (${dataCurta(dia)}) venceu.`, vencido: true };
  return { texto: `${quem} responde até ${dataCurta(dia)}`, vencido: false };
}

export function CartaoEmAndamento({
  pedido,
  hoje,
  onCancelado,
}: {
  pedido: PedidoVisao;
  hoje: string;
  onCancelado: () => void;
}) {
  const status = statusDoPedido(pedido.status, pedido.fim, hoje);
  const prazo = textoPrazo(pedido, hoje);
  return (
    <Card animado>
      <CardHeader
        nivel="h3"
        titulo={pedido.tipo}
        descricao={`${periodo(pedido.inicio, pedido.fim)} · ${plural(pedido.diasUteis, "dia útil", "dias úteis")}`}
        acao={
          <Badge tom={status.tom} pontinho tamanho="md">
            {status.rotulo}
          </Badge>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <TrilhoPedido etapa={pedido.etapa} />
        <div>
          <p className="text-base font-semibold text-strong">Aguardando aprovação do seu gestor</p>
          {prazo ? (
            <p className={prazo.vencido ? "mt-1 text-sm font-medium text-warning-700" : "mt-1 text-sm text-body"}>
              {prazo.vencido ? <span className="font-semibold">Prazo vencido. </span> : null}
              {prazo.texto}
            </p>
          ) : null}
        </div>
        {pedido.excedeSaldo ? (
          <Alert tipo="alerta" titulo="Saldo insuficiente">
            Saldo insuficiente: seu gestor viu sua justificativa.
          </Alert>
        ) : null}
        {pedido.permitido.cancelar ? (
          <div>
            <BotaoCancelar pedido={pedido} onCancelado={onCancelado} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
