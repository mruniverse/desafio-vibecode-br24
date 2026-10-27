"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Card, CardBody, CardFooter, Spinner, Stepper, Textarea } from "@/components/ui";
import type { Etapa } from "@/components/ui";
import type { EntradaCriarPedido, PreviaPedido } from "@/lib/ausencias/servicos";
import type { Tipo } from "@/lib/ausencias/tipos";
import type { SaldoVisao } from "@/lib/ausencias/visoes";
import { api, type ErroApi, type Resp } from "./api";
import { useAusencias } from "./contexto";
import { Carregando, ErroTela, Vazio } from "./estados";
import { dataComSemana, dataCompleta, dataCurta, periodo, plural } from "./formatos";
import { LinkBotao } from "./lista-pedidos";
import { dataValida, diasCorridos, MAX_DIAS, SeletorPeriodo, voltaAoTrabalho } from "./seletor-periodo";
import { useCarregar } from "./use-carregar";

const ETAPAS: Etapa[] = [
  { id: "tipo", titulo: "O que você precisa?" },
  { id: "quando", titulo: "Quando?" },
  { id: "confirmar", titulo: "Confira e envie" },
];

const DESCRICAO_TIPO: Record<string, string> = {
  ferias: "Dias de descanso anuais",
  folga: "Um dia de folga do seu saldo",
  outro: "Consultas, compromissos e outros motivos",
  viagem: "Viagem a trabalho",
  doenca: "Atestado ou tratamento de saúde",
  maternidade: "Licença-maternidade",
  "sem-vencimento": "Afastamento sem pagamento",
  "sem-permissao": "Lançado pelo administrador",
};

const SUBTITULO_PASSO = [
  "Escolha o tipo de ausência. Outros tipos, como ausência sem permissão, são lançados pelo administrador.",
  "Escolha o primeiro e o último dia. Você pode ajustar quantos dias com os botões − e +.",
  "Seu gestor recebe o pedido assim que você enviar e você acompanha tudo em Meus pedidos.",
];

const MIN_JUSTIFICATIVA = 10;
const MAX_TEXTO = 500;

function dias(n: number): string {
  return plural(n, "dia útil", "dias úteis");
}

function periodoPorExtenso(inicio: string, fim: string): string {
  return inicio === fim ? dataComSemana(inicio) : `${dataComSemana(inicio)} a ${dataComSemana(fim)}`;
}

interface Base {
  tipos: Tipo[];
  saldos: SaldoVisao[];
}

async function buscarBase(): Promise<Resp<Base>> {
  const [tipos, saldos] = await Promise.all([api.tipos(), api.saldos()]);
  if (!tipos.ok) return tipos;
  if (!saldos.ok) return saldos;
  return { ok: true, dados: { tipos: tipos.dados, saldos: saldos.dados } };
}

/** Lê ?tipo=&inicio=&fim= (ex.: "Pedir nessa data") e descarta o que não vale. */
function lerParametros(params: URLSearchParams, tipos: Tipo[], hoje: string) {
  const t = params.get("tipo");
  const tipoId = t && tipos.some((x) => x.id === t) ? t : null;
  let inicio = params.get("inicio") ?? "";
  let fim = params.get("fim") ?? "";
  if (!dataValida(inicio) || inicio < hoje) {
    inicio = "";
    fim = "";
  } else if (!dataValida(fim) || fim < inicio || diasCorridos(inicio, fim) > MAX_DIAS) {
    fim = inicio;
  }
  return { tipoId, inicio, fim };
}

/** Problema com as datas escolhidas (null = sem problema ou ainda incompletas). */
function problemaDoPeriodo(inicio: string, fim: string, hoje: string): string | null {
  if (!inicio || !fim) return null;
  if (!dataValida(inicio) || !dataValida(fim)) return "Escolha datas válidas.";
  if (inicio < hoje) return `O primeiro dia não pode ser antes de hoje (${dataCompleta(hoje)}).`;
  if (fim < inicio) return "O último dia não pode ser antes do primeiro.";
  if (diasCorridos(inicio, fim) > MAX_DIAS) return `O período pode ter no máximo ${MAX_DIAS} dias.`;
  return null;
}

function IconeCheck() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="size-7">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/* ------------------------------ Passo 1: tipo ------------------------------ */

function PassoTipo({
  tipos,
  saldos,
  tipoId,
  onEscolher,
}: {
  tipos: Tipo[];
  saldos: SaldoVisao[];
  tipoId: string | null;
  onEscolher: (id: string) => void;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">Tipo de ausência</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {tipos.map((t) => {
          const saldo = t.consomeSaldo ? saldos.find((s) => s.carteira === t.consomeSaldo) : undefined;
          return (
            <label key={t.id} className="relative block cursor-pointer">
              <input
                type="radio"
                name="tipo-ausencia"
                value={t.id}
                checked={tipoId === t.id}
                onChange={() => onEscolher(t.id)}
                className="peer sr-only"
              />
              <span className="flex min-h-20 items-start gap-3 rounded-lg border border-line bg-card p-4 shadow-sm transition-colors hover:bg-muted peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:ring-2 peer-checked:ring-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: t.cor }}
                />
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-strong">{t.nome}</span>
                  {DESCRICAO_TIPO[t.id] ? (
                    <span className="mt-0.5 block text-sm text-body">{DESCRICAO_TIPO[t.id]}</span>
                  ) : null}
                  {saldo ? (
                    <span className="mt-1 block text-sm font-medium text-soft">
                      Saldo disponível: {dias(saldo.disponivel)}
                    </span>
                  ) : null}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ------------------------------ Passo 2: quando ------------------------------ */

function ResultadoPrevia({
  carregando,
  erro,
  previa,
  inicio,
  fim,
  tipo,
  saldoAntes,
  onTentarDeNovo,
  onEscolherDatas,
}: {
  carregando: boolean;
  erro: ErroApi | null;
  previa: PreviaPedido | null;
  inicio: string;
  fim: string;
  tipo: Tipo;
  saldoAntes: number | null;
  onTentarDeNovo: () => void;
  onEscolherDatas: (inicio: string, fim: string) => void;
}) {
  if (carregando) {
    return (
      <p className="flex items-center gap-2 text-sm text-soft">
        <Spinner tamanho="sm" decorativo />
        Calculando seus dias…
      </p>
    );
  }
  if (erro) {
    return (
      <Alert
        tipo="erro"
        titulo="Não foi possível calcular esse período"
        acao={
          <Button variante="secondary" tamanho="sm" onClick={onTentarDeNovo}>
            Tentar de novo
          </Button>
        }
      >
        {erro.mensagem}
      </Alert>
    );
  }
  if (!previa) return null;

  if (previa.diasUteis === 0) {
    return (
      <Alert tipo="alerta" titulo="Esse período não tem dias úteis">
        Só há fim de semana ou feriado entre essas datas. Escolha outras datas.
      </Alert>
    );
  }

  const corridos = diasCorridos(inicio, fim);
  const consome = tipo.consomeSaldo !== null && saldoAntes !== null;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-3 rounded-md bg-muted p-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-soft">Saída</dt>
          <dd className="text-base font-semibold text-strong">{dataComSemana(inicio)}</dd>
        </div>
        <div>
          <dt className="text-sm text-soft">Volta ao trabalho</dt>
          <dd className="text-base font-semibold text-strong">{dataComSemana(voltaAoTrabalho(fim))}</dd>
        </div>
        <div>
          <dt className="text-sm text-soft">Dias úteis</dt>
          <dd className="text-base font-semibold text-strong">
            {dias(previa.diasUteis)}
            {corridos !== previa.diasUteis ? (
              <span className="font-normal text-body"> ({corridos} corridos)</span>
            ) : null}
          </dd>
        </div>
        {consome ? (
          <div>
            <dt className="text-sm text-soft">Seu saldo</dt>
            <dd className="text-base font-semibold text-strong">
              {saldoAntes} → {previa.saldoDepois} dias úteis
            </dd>
          </div>
        ) : null}
      </dl>

      {previa.excedeSaldo ? (
        <Alert tipo="alerta" titulo="Saldo insuficiente">
          Você ainda pode pedir. No próximo passo, explique o motivo para o seu gestor decidir.
        </Alert>
      ) : null}

      {previa.conflitoEquipe ? (
        <Alert tipo="alerta" titulo="Conflito com a equipe">
          Neste período já há ausências na sua equipe. Seu pedido continua valendo.
        </Alert>
      ) : null}

      {previa.datasLivres.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-strong">Datas livres com {dias(previa.diasUteis)}:</p>
          <ul className="flex flex-wrap gap-2">
            {previa.datasLivres.map((d) => (
              <li key={`${d.inicio}-${d.fim}`}>
                <Button
                  variante="secondary"
                  tamanho="sm"
                  onClick={() => onEscolherDatas(d.inicio, d.fim)}
                  aria-label={`Usar as datas livres ${periodo(d.inicio, d.fim)}`}
                >
                  {dataCurta(d.inicio)} a {dataCurta(d.fim)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Fluxo ------------------------------ */

interface Enviado {
  tipoNome: string;
  periodo: string;
  aprovador: string;
}

function Fluxo({ tipos, saldos }: Base) {
  const { hoje } = useAusencias();
  const params = useSearchParams();
  const [inicial] = React.useState(() => lerParametros(new URLSearchParams(params.toString()), tipos, hoje));

  const [passo, setPasso] = React.useState(inicial.tipoId ? 1 : 0);
  const [tipoId, setTipoId] = React.useState<string | null>(inicial.tipoId);
  const [inicio, setInicio] = React.useState(inicial.inicio);
  const [fim, setFim] = React.useState(inicial.fim);
  const [justificativa, setJustificativa] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [tentativa, setTentativa] = React.useState(0);
  const [resultado, setResultado] = React.useState<{ chave: string; resp: Resp<PreviaPedido> } | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [erroEnvio, setErroEnvio] = React.useState<ErroApi | null>(null);
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const [enviado, setEnviado] = React.useState<Enviado | null>(null);

  const tituloRef = React.useRef<HTMLHeadingElement>(null);
  const sucessoRef = React.useRef<HTMLHeadingElement>(null);
  const passoAnterior = React.useRef(passo);

  const tipo = tipos.find((t) => t.id === tipoId) ?? null;
  const saldoAntes = tipo?.consomeSaldo
    ? (saldos.find((s) => s.carteira === tipo.consomeSaldo)?.disponivel ?? null)
    : null;

  const problema = problemaDoPeriodo(inicio, fim, hoje);
  const periodoPronto = Boolean(inicio && fim) && problema === null;
  const chave = passo >= 1 && tipoId && periodoPronto ? `${tipoId}|${inicio}|${fim}|${tentativa}` : null;

  // Prévia: espera 300 ms depois da última mudança e ignora respostas antigas.
  React.useEffect(() => {
    if (!chave || !tipoId) return;
    let vivo = true;
    const espera = window.setTimeout(async () => {
      const resp = await api.previa({ tipoId, inicio, fim });
      if (vivo) setResultado({ chave, resp });
    }, 300);
    return () => {
      vivo = false;
      window.clearTimeout(espera);
    };
  }, [chave, tipoId, inicio, fim]);

  // Foco no título do passo ao trocar (leitor de tela anuncia onde está).
  React.useEffect(() => {
    if (passoAnterior.current !== passo) {
      passoAnterior.current = passo;
      tituloRef.current?.focus();
    }
  }, [passo]);

  React.useEffect(() => {
    if (enviado) sucessoRef.current?.focus();
  }, [enviado]);

  const respPrevia = resultado && resultado.chave === chave ? resultado.resp : null;
  const previa = respPrevia && respPrevia.ok ? respPrevia.dados : null;
  const erroPrevia = respPrevia && !respPrevia.ok ? respPrevia.erro : null;
  const carregandoPrevia = chave !== null && respPrevia === null;
  const podeContinuar2 = previa !== null && previa.diasUteis > 0;

  function mudarPeriodo(i: string, f: string) {
    setInicio(i);
    setFim(f);
  }

  function irPara(p: number) {
    setErroEnvio(null);
    setErroLocal(null);
    setPasso(p);
  }

  function recomecar() {
    setPasso(0);
    setTipoId(null);
    setInicio("");
    setFim("");
    setJustificativa("");
    setMotivo("");
    setResultado(null);
    setErroEnvio(null);
    setErroLocal(null);
    setEnviado(null);
  }

  async function enviar() {
    if (!tipo || !previa) return;
    const texto = (tipo.sensivel ? motivo : justificativa).trim();
    setErroEnvio(null);
    setErroLocal(null);
    if (!tipo.sensivel) {
      if (previa.excedeSaldo && texto.length === 0) {
        setErroLocal("Explique o motivo: seu saldo não cobre esses dias.");
        return;
      }
      if (texto.length > 0 && texto.length < MIN_JUSTIFICATIVA) {
        setErroLocal(`Escreva pelo menos ${MIN_JUSTIFICATIVA} caracteres.`);
        return;
      }
    }
    const entrada: EntradaCriarPedido = { tipoId: tipo.id, inicio, fim };
    if (texto) {
      if (tipo.sensivel) entrada.motivoPrivado = texto;
      else entrada.justificativa = texto;
    }
    setEnviando(true);
    const r = await api.criarPedido(entrada);
    setEnviando(false);
    if (r.ok) {
      setEnviado({
        tipoNome: tipo.nome,
        periodo: periodo(r.dados.inicio, r.dados.fim),
        aprovador: r.dados.aprovador?.nome ?? previa.aprovador.nome,
      });
    } else {
      setErroEnvio(r.erro);
    }
  }

  /* ------------------------------ Tela final ------------------------------ */
  if (enviado) {
    return (
      <Card animado>
        <CardBody className="flex flex-col items-center gap-4 py-8 text-center sm:py-10">
          <span className="grid size-14 place-items-center rounded-full bg-success-50 text-success-700">
            <IconeCheck />
          </span>
          <div role="status" className="flex flex-col gap-2">
            <h2 ref={sucessoRef} tabIndex={-1} className="text-xl font-semibold text-strong">
              Pedido enviado!
            </h2>
            <p className="max-w-prose text-base text-body">
              Seu pedido de {enviado.tipoNome.toLowerCase()} ({enviado.periodo}) está com {enviado.aprovador}. Você
              recebe cada atualização aqui no app.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <LinkBotao href="/ausencias/meus-pedidos">Acompanhar meu pedido</LinkBotao>
            <Button variante="secondary" onClick={recomecar}>
              Fazer outro pedido
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  /* ------------------------------ Passos ------------------------------ */
  const camposServidor = erroEnvio?.campos ?? {};
  const erroDoCampo = erroLocal ?? camposServidor.justificativa ?? camposServidor.motivoPrivado;
  const msgGeral =
    erroEnvio && !(erroEnvio.campos && (camposServidor.justificativa || camposServidor.motivoPrivado))
      ? [erroEnvio.mensagem, ...Object.values(camposServidor)].filter((m, i, a) => m && a.indexOf(m) === i).join(" ")
      : null;

  return (
    <div className="flex flex-col gap-5">
      <Stepper
        etapas={ETAPAS}
        atual={passo}
        concluidas={Array.from({ length: passo }, (_, i) => i)}
        rotulo="Passos do pedido de ausência"
      />

      <Card>
        <CardBody className="flex flex-col gap-5">
          <div>
            <h2 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold text-strong">
              {ETAPAS[passo].titulo}
            </h2>
            <p className="mt-1 text-sm text-body">{SUBTITULO_PASSO[passo]}</p>
          </div>

          {passo === 0 ? (
            <PassoTipo tipos={tipos} saldos={saldos} tipoId={tipoId} onEscolher={setTipoId} />
          ) : null}

          {passo === 1 && tipo ? (
            <>
              <SeletorPeriodo inicio={inicio} fim={fim} min={hoje} onChange={mudarPeriodo} />
              <div aria-live="polite" className="flex flex-col gap-3">
                {problema ? <Alert tipo="alerta">{problema}</Alert> : null}
                {periodoPronto ? (
                  <ResultadoPrevia
                    carregando={carregandoPrevia}
                    erro={erroPrevia}
                    previa={previa}
                    inicio={inicio}
                    fim={fim}
                    tipo={tipo}
                    saldoAntes={saldoAntes}
                    onTentarDeNovo={() => setTentativa((n) => n + 1)}
                    onEscolherDatas={mudarPeriodo}
                  />
                ) : null}
              </div>
            </>
          ) : null}

          {passo === 2 && tipo && previa ? (
            <>
              <div className="flex flex-col gap-3 rounded-md bg-muted p-4">
                <p className="text-lg font-semibold text-strong">
                  {tipo.nome} · {dias(previa.diasUteis)}
                </p>
                <p className="text-base text-body">{periodoPorExtenso(inicio, fim)}</p>
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-soft">Volta ao trabalho</dt>
                    <dd className="text-sm font-semibold text-strong">{dataComSemana(voltaAoTrabalho(fim))}</dd>
                  </div>
                  {tipo.consomeSaldo ? (
                    <div>
                      <dt className="text-sm text-soft">Saldo depois da aprovação</dt>
                      <dd className="text-sm font-semibold text-strong">{dias(previa.saldoDepois)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-sm text-soft">Quem aprova</dt>
                    <dd className="text-sm font-semibold text-strong">{previa.aprovador.nome}</dd>
                  </div>
                </dl>
              </div>

              {previa.excedeSaldo ? (
                <Alert tipo="alerta" titulo="Saldo insuficiente">
                  Seu saldo não cobre esses dias. Explique o motivo: seu gestor lê isso antes de decidir.
                </Alert>
              ) : null}
              {previa.conflitoEquipe ? (
                <Alert tipo="info">
                  Neste período já há ausências na sua equipe. Seu pedido continua valendo. Explicar o motivo ajuda
                  seu gestor a decidir.
                </Alert>
              ) : null}

              {tipo.sensivel ? (
                <Textarea
                  rotulo="Motivo (só você e o RH veem)"
                  ajuda="Opcional. Seu gestor não vê este motivo."
                  value={motivo}
                  maxLength={MAX_TEXTO}
                  onChange={(e) => setMotivo(e.target.value)}
                  erro={erroDoCampo}
                />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Textarea
                    rotulo={previa.excedeSaldo ? "Justificativa" : "Justificativa (opcional)"}
                    obrigatorio={previa.excedeSaldo}
                    ajuda="Seu gestor lê isso antes de decidir."
                    aria-describedby="aviso-saude"
                    value={justificativa}
                    maxLength={MAX_TEXTO}
                    onChange={(e) => setJustificativa(e.target.value)}
                    erro={erroDoCampo}
                  />
                  <p id="aviso-saude" className="text-sm font-medium text-warning-700">
                    Não escreva dados de saúde aqui.
                  </p>
                </div>
              )}

              {msgGeral ? <Alert tipo="erro" titulo="Não foi possível enviar o pedido">{msgGeral}</Alert> : null}
            </>
          ) : null}
        </CardBody>

        <CardFooter>
          {passo > 0 ? (
            <Button variante="secondary" onClick={() => irPara(passo - 1)} disabled={enviando}>
              Voltar
            </Button>
          ) : null}
          {passo === 0 ? (
            <Button disabled={!tipo} onClick={() => irPara(1)}>
              Continuar
            </Button>
          ) : null}
          {passo === 1 ? (
            <Button disabled={!podeContinuar2} onClick={() => irPara(2)}>
              Continuar
            </Button>
          ) : null}
          {passo === 2 ? (
            <Button onClick={enviar} loading={enviando} disabled={!previa}>
              Enviar pedido
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </div>
  );
}

function PedirConteudo() {
  const buscar = React.useCallback(() => buscarBase(), []);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  if (estado.status === "carregando") return <Carregando rotulo="Carregando os tipos de ausência…" />;
  if (estado.status === "erro") return <ErroTela erro={estado.erro} onTentarDeNovo={tentarDeNovo} />;
  if (estado.dados.tipos.length === 0) {
    return (
      <Vazio
        titulo="Nenhum tipo de ausência liberado para você"
        descricao="Fale com o administrador para liberar os tipos de ausência."
        acao={<LinkBotao href="/ausencias/meus-pedidos">Voltar para Meus pedidos</LinkBotao>}
      />
    );
  }
  return <Fluxo tipos={estado.dados.tipos} saldos={estado.dados.saldos} />;
}

export function TelaPedir() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-strong">Pedir ausência</h1>
        <LinkBotao href="/ausencias/meus-pedidos" variante="ghost" className="shrink-0">
          Cancelar
        </LinkBotao>
      </div>
      <React.Suspense fallback={<Carregando rotulo="Abrindo o pedido…" />}>
        <PedirConteudo />
      </React.Suspense>
    </div>
  );
}
