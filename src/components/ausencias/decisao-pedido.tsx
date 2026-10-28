"use client";

/**
 * Botões de decisão do pedido (Aprovar / Recusar / Sugerir outra data) e os
 * formulários que abrem logo abaixo. Só desenha ações se `permitido.decidir`.
 */
import * as React from "react";
import type { ImpactoPedidoVisao, PedidoVisao } from "@/lib/ausencias/visoes";
import { Alert, Button, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api, type ErroApi } from "./api";
import { dataCurta, primeiroNome } from "./formatos";

type Modo = "recusar" | "sugerir" | null;
type Alternativa = ImpactoPedidoVisao["alternativas"][number];

const MIN_MOTIVO = 10;
const MAX_MOTIVO = 500;
const MOTIVO_SUGESTAO = "Sugiro outras datas para manter a equipe no mínimo.";

function validarMotivo(texto: string): string | null {
  const n = texto.trim().length;
  if (n < MIN_MOTIVO) return `Escreva pelo menos ${MIN_MOTIVO} caracteres para explicar.`;
  if (n > MAX_MOTIVO) return `Use no máximo ${MAX_MOTIVO} caracteres.`;
  return null;
}

export interface DecisaoPedidoProps {
  pedido: PedidoVisao;
  /** null enquanto o impacto ainda carrega (ou falhou). */
  alternativas: Alternativa[] | null;
  /** Chamado depois de decidir (ou de um conflito) para a fila ser recarregada. */
  onAtualizar: (aviso?: string) => void;
}

export function DecisaoPedido({ pedido, alternativas, onAtualizar }: DecisaoPedidoProps) {
  const toast = useToast();
  const primeiro = primeiroNome(pedido.pessoa.nome);
  const [modo, setModo] = React.useState<Modo>(null);
  const [motivo, setMotivo] = React.useState("");
  const [escolhida, setEscolhida] = React.useState<number | null>(null);
  const [erroMotivo, setErroMotivo] = React.useState<string | null>(null);
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState<"aprovar" | "recusar" | "sugerir" | null>(null);
  /** Texto do conflito de recálculo (calendário mudou): pede confirmação explícita antes de aprovar. */
  const [recalculo, setRecalculo] = React.useState<{ mensagem: string; assinatura: string } | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (modo) formRef.current?.focus();
  }, [modo]);

  if (!pedido.permitido.decidir) {
    return (
      <p className="rounded-md border border-line bg-muted px-4 py-3 text-sm text-body">
        Você só visualiza este pedido.
        {pedido.aprovador ? ` Quem aprova é ${pedido.aprovador.nome}.` : ""}
      </p>
    );
  }

  function abrir(novo: Exclude<Modo, null>) {
    setRecalculo(null); // recusar/sugerir descarta a confirmação pendente de aprovar
    setModo(novo);
    setErroMotivo(null);
    setErroGeral(null);
    setEscolhida(null);
    setMotivo(novo === "sugerir" ? MOTIVO_SUGESTAO : "");
  }

  function fechar() {
    setModo(null);
    setErroMotivo(null);
    setErroGeral(null);
  }

  /** 409 = alguém mudou/decidiu antes de você: avisa e recarrega a fila. */
  function tratarErro(erro: ErroApi, status: number) {
    if (status === 409) {
      onAtualizar(erro.mensagem);
      return;
    }
    if (erro.campos?.motivoDecisao) setErroMotivo(erro.campos.motivoDecisao);
    else setErroGeral(erro.mensagem);
  }

  async function aprovar() {
    if (enviando !== null) return; // duplo clique
    setEnviando("aprovar");
    setErroGeral(null);
    const r = await api.decidir(pedido.id, {
      decisao: "aprovar",
      versao: pedido.versao,
      ...(recalculo ? { confirmarRecalculo: recalculo.assinatura } : {}),
    });
    if (!r.ok) {
      setEnviando(null);
      // Calendário mudou desde o pedido: mostra o recálculo (novo, se mudou de novo) e deixa o gestor confirmar.
      const assinatura = r.status === 409 ? r.erro.extras?.recalculo : undefined;
      if (assinatura) {
        setRecalculo({ mensagem: r.erro.mensagem, assinatura });
        return;
      }
      tratarErro(r.erro, r.status);
      return;
    }
    // Mantém os botões travados (`enviando`) até a fila recarregar: evita nova decisão sobre pedido já decidido.
    setRecalculo(null);
    toast.sucesso(`Pedido de ${primeiro} aprovado.`);
    onAtualizar();
  }

  async function enviarRecusa(e: React.FormEvent) {
    e.preventDefault();
    if (!modo) return;
    const invalido = validarMotivo(motivo);
    if (invalido) {
      setErroMotivo(invalido);
      return;
    }
    const alt = modo === "sugerir" && escolhida !== null ? alternativas?.[escolhida] : undefined;
    if (modo === "sugerir" && !alt) {
      setErroGeral("Escolha uma das datas sugeridas.");
      return;
    }
    setEnviando(modo);
    setErroMotivo(null);
    setErroGeral(null);
    const r = await api.decidir(pedido.id, {
      decisao: "recusar",
      motivoDecisao: motivo.trim(),
      sugestao: alt ? { inicio: alt.inicio, fim: alt.fim } : undefined,
      versao: pedido.versao,
    });
    setEnviando(null);
    if (!r.ok) {
      tratarErro(r.erro, r.status);
      return;
    }
    toast.sucesso(
      modo === "sugerir" ? `Sugestão de outra data enviada para ${primeiro}.` : `Pedido de ${primeiro} recusado.`,
    );
    onAtualizar();
  }

  const ocupado = enviando !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button
          variante="secondary"
          onClick={() => abrir("recusar")}
          disabled={ocupado}
          aria-expanded={modo === "recusar"}
        >
          Recusar
        </Button>
        <Button
          variante="secondary"
          onClick={() => abrir("sugerir")}
          disabled={ocupado || alternativas === null}
          aria-expanded={modo === "sugerir"}
        >
          Sugerir outra data
        </Button>
        <Button onClick={() => void aprovar()} loading={enviando === "aprovar"} disabled={ocupado}>
          {recalculo ? "Confirmar e aprovar" : "Aprovar"}
        </Button>
      </div>

      {recalculo ? <Alert tipo="alerta">{recalculo.mensagem}</Alert> : null}
      {erroGeral && modo === null ? <Alert tipo="erro">{erroGeral}</Alert> : null}

      {modo ? (
        <form
          ref={formRef}
          tabIndex={-1}
          onSubmit={(e) => void enviarRecusa(e)}
          aria-label={modo === "recusar" ? "Recusar pedido" : "Sugerir outra data"}
          className="flex flex-col gap-4 rounded-md border border-line bg-muted px-4 py-4"
        >
          {modo === "sugerir" ? (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="text-sm font-semibold text-strong">
                Escolha uma data sem conflito para sugerir a {primeiro}
              </legend>
              {alternativas && alternativas.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {alternativas.map((alt, i) => (
                    <label
                      key={`${alt.inicio}-${alt.fim}`}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm text-body",
                        escolhida === i ? "border-brand-600 ring-1 ring-brand-600" : "border-line hover:border-line-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name={`alternativa-${pedido.id}`}
                        checked={escolhida === i}
                        onChange={() => {
                          setEscolhida(i);
                          setErroGeral(null);
                        }}
                        className="size-4 shrink-0 accent-brand-600"
                      />
                      <span>
                        {dataCurta(alt.inicio)} a {dataCurta(alt.fim)} · {alt.motivo}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-body">
                  Não encontramos datas sem conflito para sugerir. Use “Recusar” e explique o motivo.
                </p>
              )}
            </fieldset>
          ) : null}

          <Textarea
            rotulo={
              modo === "recusar"
                ? `Conte para ${primeiro} por que o pedido foi recusado`
                : `Mensagem para ${primeiro}`
            }
            obrigatorio
            value={motivo}
            maxLength={MAX_MOTIVO}
            onChange={(e) => {
              setMotivo(e.target.value);
              setErroMotivo(null);
            }}
            erro={erroMotivo ?? undefined}
            ajuda={`Mínimo ${MIN_MOTIVO} caracteres. ${motivo.trim().length}/${MAX_MOTIVO}.`}
          />

          {erroGeral ? <Alert tipo="erro">{erroGeral}</Alert> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variante="ghost" onClick={fechar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variante={modo === "recusar" ? "danger" : "primary"}
              loading={enviando === modo}
              disabled={ocupado || (modo === "sugerir" && (alternativas?.length ?? 0) === 0)}
            >
              {modo === "recusar" ? "Recusar pedido" : "Sugerir"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
