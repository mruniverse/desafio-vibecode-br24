"use client";

/**
 * Assistente de configuração inicial (3 etapas).
 *
 * Padrão de UX: DIVULGAÇÃO PROGRESSIVA. O webhook aparece sozinho e em
 * destaque porque resolve 95% dos casos em ~1 minuto; o OAuth fica atrás de
 * "Opções avançadas" e é apresentado pelos benefícios extras que concede —
 * nunca como obrigação nem como alternativa de segunda classe.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CopyField,
  FieldGroup,
  Input,
  Stepper,
  useToast,
  type Etapa,
} from "@/components/ui";
import {
  MODOS,
  MODO_OAUTH,
  MODO_WEBHOOK,
  avisoPermissaoWebhook,
  type DescricaoModo,
} from "@/lib/connection-modes";
import { cn } from "@/lib/utils";

import {
  postJson,
  type DadosOauth,
  type DadosWebhook,
  type ErroApi,
} from "./api-cliente";

type IdModo = DescricaoModo["id"];

const ETAPAS: Etapa[] = [
  {
    id: "modo",
    titulo: "Como conectar",
    descricao: "Escolha a forma de ligar seu Bitrix24",
  },
  {
    id: "conectar",
    titulo: "Conectar o portal",
    descricao: "Informe os dados do seu portal",
  },
  {
    id: "pronto",
    titulo: "Pronto",
    descricao: "Confirmação da conexão",
  },
];

/** Escopos que o aplicativo usa — o cliente precisa marcá-los no portal. */
const ESCOPOS_NECESSARIOS = [
  { codigo: "crm", nome: "CRM" },
  { codigo: "task", nome: "Tarefas" },
  { codigo: "user", nome: "Usuários" },
];

export interface WizardConfiguracaoProps {
  /** URL de redirecionamento do OAuth, calculada no servidor. */
  redirectUri: string;
}

export function WizardConfiguracao({ redirectUri }: WizardConfiguracaoProps) {
  const router = useRouter();
  const toast = useToast();

  const [etapa, setEtapa] = React.useState(0);
  const [modo, setModo] = React.useState<IdModo>("WEBHOOK");
  const [avancadoAberto, setAvancadoAberto] = React.useState(false);

  // Os valores digitados ficam aqui, fora das etapas: voltar uma etapa nunca
  // apaga o que o cliente já preencheu.
  const [webhookUrl, setWebhookUrl] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");

  const [enviando, setEnviando] = React.useState(false);
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [errosCampo, setErrosCampo] = React.useState<Record<string, string>>(
    {},
  );
  const [conectado, setConectado] = React.useState<DadosWebhook | null>(null);

  // Foco no título ao trocar de etapa: sem isso, quem usa leitor de tela ou
  // teclado continua no botão antigo e não percebe que a tela mudou.
  const refTitulo = React.useRef<HTMLHeadingElement>(null);
  const primeiraRenderizacao = React.useRef(true);

  React.useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    refTitulo.current?.focus();
  }, [etapa]);

  // Erro de validação leva o foco ao primeiro campo com problema: o cliente
  // pode estar com o campo fora da tela e nunca ver a mensagem.
  const refFormulario = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (Object.keys(errosCampo).length === 0) return;
    const invalido =
      refFormulario.current?.querySelector<HTMLInputElement>(
        '[aria-invalid="true"]',
      );
    invalido?.focus();
    invalido?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [errosCampo]);

  function limparMensagens() {
    setErroGeral(null);
    setErrosCampo({});
  }

  function tratarErro(erro: ErroApi) {
    if (erro.campos && Object.keys(erro.campos).length > 0) {
      setErrosCampo(erro.campos);
      setErroGeral(null);
      return;
    }
    setErrosCampo({});
    setErroGeral(erro.mensagem);
  }

  function irPara(indice: number) {
    limparMensagens();
    setEtapa(indice);
  }

  /* ------------------------------------------------------ etapa 1: modo */

  const modosVisiveis = avancadoAberto ? MODOS : [MODO_WEBHOOK];
  const refsCartao = React.useRef<Record<string, HTMLDivElement | null>>({});

  // Navegação por setas dentro do radiogroup, como manda o padrão ARIA.
  function navegarEntreModos(direcao: 1 | -1) {
    if (modosVisiveis.length < 2) return;
    const atual = modosVisiveis.findIndex((m) => m.id === modo);
    const indice =
      (atual + direcao + modosVisiveis.length) % modosVisiveis.length;
    const proximo = modosVisiveis[indice];
    setModo(proximo.id);
    refsCartao.current[proximo.id]?.focus();
  }

  function alternarAvancado() {
    const abrindo = !avancadoAberto;
    setAvancadoAberto(abrindo);
    // Fechar o painel volta a seleção para o webhook: nunca deixamos uma
    // opção selecionada escondida da tela.
    if (!abrindo && modo === "OAUTH") setModo("WEBHOOK");
  }

  /* ------------------------------------------------- etapa 2: conexão */

  async function conectarWebhook() {
    limparMensagens();
    setEnviando(true);
    const resposta = await postJson<DadosWebhook>("/api/setup/webhook", {
      webhookUrl,
    });
    setEnviando(false);

    if (!resposta.ok) {
      tratarErro(resposta.erro);
      return;
    }

    setConectado(resposta.dados);
    setEtapa(2);
    toast.sucesso("Portal conectado!", {
      descricao: `${resposta.dados.domain} está respondendo normalmente.`,
    });
  }

  async function iniciarOauth() {
    limparMensagens();
    setEnviando(true);
    const resposta = await postJson<DadosOauth>("/api/setup/oauth", {
      domain,
      clientId,
      clientSecret,
    });

    if (!resposta.ok) {
      setEnviando(false);
      tratarErro(resposta.erro);
      return;
    }

    // Mantemos `enviando` ligado: o navegador sai desta página agora e um
    // botão que volta ao normal daria a impressão de que nada aconteceu.
    toast.info("Redirecionando para o seu Bitrix24...", {
      descricao: "Autorize o aplicativo para concluir a conexão.",
    });
    window.location.href = resposta.dados.urlAutorizar;
  }

  function enviarEtapa2(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    if (modo === "WEBHOOK") {
      void conectarWebhook();
    } else {
      void iniciarOauth();
    }
  }

  /* ------------------------------------------------------------ render */

  const tituloEtapa =
    etapa === 0
      ? "Como você quer conectar seu Bitrix24?"
      : etapa === 1
        ? modo === "WEBHOOK"
          ? "Gere o webhook no seu Bitrix24"
          : "Cadastre o aplicativo local no seu Bitrix24"
        : "Tudo pronto!";

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        etapas={ETAPAS}
        atual={etapa}
        concluidas={Array.from({ length: etapa }, (_, i) => i)}
      />

      <Card animado>
        <CardHeader
          nivel="h2"
          acao={
            etapa === 1 ? (
              <Badge tom={modo === "WEBHOOK" ? "sucesso" : "marca"}>
                {modo === "WEBHOOK" ? MODO_WEBHOOK.titulo : MODO_OAUTH.titulo}
              </Badge>
            ) : null
          }
        >
          {/* tabIndex -1: recebe o foco por código na troca de etapa, mas não
              entra na ordem de tabulação. */}
          <h2
            ref={refTitulo}
            tabIndex={-1}
            className="text-lg font-semibold text-strong"
          >
            {tituloEtapa}
          </h2>
          <p className="mt-1 text-sm text-soft">
            {etapa === 0
              ? "Os dois modos usam a API REST oficial do Bitrix24. Comece pelo recomendado — você pode trocar depois."
              : etapa === 1
                ? "Siga os passos abaixo no seu portal e preencha os campos. Nada é salvo antes de a conexão ser testada."
                : "O aplicativo já conversa com o seu portal Bitrix24."}
          </p>
        </CardHeader>

        {etapa === 0 ? (
          <>
            <CardBody className="flex flex-col gap-4">
              <div
                role="radiogroup"
                aria-label="Modo de conexão com o Bitrix24"
                className="flex flex-col gap-3"
              >
                {modosVisiveis.map((descricao) => (
                  <CartaoModo
                    key={descricao.id}
                    descricao={descricao}
                    selecionado={modo === descricao.id}
                    refCartao={(elemento) => {
                      refsCartao.current[descricao.id] = elemento;
                    }}
                    onSelecionar={() => setModo(descricao.id)}
                    onNavegar={navegarEntreModos}
                  />
                ))}
              </div>

              {/* Divulgação progressiva: o modo avançado existe, está visível
                  como possibilidade, mas não disputa atenção com o caminho
                  curto nem aparece como obrigação. */}
              <div className="rounded-md border border-line bg-muted/60">
                <button
                  type="button"
                  onClick={alternarAvancado}
                  aria-expanded={avancadoAberto}
                  aria-controls="painel-modo-avancado"
                  className="flex w-full items-center gap-2.5 rounded-md px-4 py-3 text-left transition-colors duration-150 hover:bg-muted"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-soft transition-transform duration-200",
                      avancadoAberto && "rotate-90",
                    )}
                  >
                    <path d="M7.21 4.47a.75.75 0 0 1 1.06-.02l5 4.75a.75.75 0 0 1 0 1.086l-5 4.75a.75.75 0 1 1-1.04-1.082L11.654 10 7.23 5.53a.75.75 0 0 1-.02-1.06Z" />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-strong">
                      {avancadoAberto
                        ? "Ocultar opções avançadas"
                        : "Ver opções avançadas"}
                    </span>
                    <span className="mt-0.5 block text-sm text-soft">
                      Um passo a mais que concede permissão por usuário,
                      registro de quem fez cada ação e widgets dentro do
                      Bitrix24.
                    </span>
                  </span>
                </button>

                {avancadoAberto ? (
                  <div
                    id="painel-modo-avancado"
                    className="br24-fade-up border-t border-line px-4 py-3"
                  >
                    <p className="text-sm text-body">
                      O modo <strong>{MODO_OAUTH.titulo}</strong> foi adicionado
                      à lista acima. Ele leva {MODO_OAUTH.tempo} e é indicado
                      quando mais de uma pessoa vai usar o aplicativo com níveis
                      de acesso diferentes.
                    </p>
                  </div>
                ) : null}
              </div>
            </CardBody>

            <CardFooter>
              <p className="text-sm text-soft sm:mr-auto">
                Tempo estimado:{" "}
                {modo === "WEBHOOK" ? MODO_WEBHOOK.tempo : MODO_OAUTH.tempo}
              </p>
              <Button
                onClick={() => irPara(1)}
                iconeDireita={<SetaDireita />}
                full
                className="sm:w-auto"
              >
                Continuar
              </Button>
            </CardFooter>
          </>
        ) : null}

        {etapa === 1 ? (
          <form ref={refFormulario} onSubmit={enviarEtapa2} noValidate>
            <CardBody className="flex flex-col gap-5">
              <PassosNoPortal
                passos={
                  modo === "WEBHOOK"
                    ? MODO_WEBHOOK.passosNoPortal
                    : MODO_OAUTH.passosNoPortal
                }
              />

              <Alert tipo="info" titulo="Permissões a marcar no portal">
                <p>
                  Marque apenas{" "}
                  {ESCOPOS_NECESSARIOS.map((escopo, i) => (
                    <React.Fragment key={escopo.codigo}>
                      {i > 0 ? ", " : ""}
                      <strong>{escopo.nome}</strong>{" "}
                      <span className="font-mono text-xs">
                        ({escopo.codigo})
                      </span>
                    </React.Fragment>
                  ))}
                  . O aplicativo não precisa de mais nada.
                </p>
              </Alert>

              {modo === "WEBHOOK" ? (
                <>
                  {/* Antes de conectar, não depois: a ressalva de permissão é
                      informação de decisão, não letra miúda. */}
                  <Alert
                    tipo="alerta"
                    titulo="Antes de continuar, saiba como funciona"
                  >
                    {avisoPermissaoWebhook(null)}
                  </Alert>

                  <Input
                    rotulo="URL do webhook de entrada"
                    obrigatorio
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    erro={errosCampo.webhookUrl}
                    ajuda="Cole a URL inteira, como ela aparece no Bitrix24."
                    placeholder="https://suaempresa.bitrix24.com.br/rest/1/abc123def456/"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                </>
              ) : (
                <>
                  <CopyField
                    rotulo="URL de redirecionamento (cole no portal)"
                    valor={redirectUri}
                    ajuda="O Bitrix24 pede este endereço ao cadastrar o aplicativo local."
                  />

                  <FieldGroup
                    titulo="Credenciais do aplicativo local"
                    descricao="A chave secreta é guardada cifrada e nunca aparece de volta na tela."
                  >
                    <Input
                      rotulo="Endereço do seu portal"
                      obrigatorio
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      erro={errosCampo.domain}
                      ajuda="Com ou sem https://. Exemplo: suaempresa.bitrix24.com.br"
                      placeholder="suaempresa.bitrix24.com.br"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Input
                      rotulo="ID do aplicativo (client_id)"
                      obrigatorio
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      erro={errosCampo.clientId}
                      placeholder="local.000000000000.00000000"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                    />
                    <Input
                      rotulo="Chave secreta (client_secret)"
                      obrigatorio
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      erro={errosCampo.clientSecret}
                      autoComplete="off"
                      className="font-mono"
                    />
                  </FieldGroup>
                </>
              )}

              {erroGeral ? (
                <Alert tipo="erro" titulo="Não foi possível conectar">
                  {erroGeral}
                </Alert>
              ) : null}
            </CardBody>

            <CardFooter>
              <Button
                variante="ghost"
                onClick={() => irPara(0)}
                disabled={enviando}
                iconeEsquerda={<SetaEsquerda />}
                className="sm:mr-auto"
              >
                Voltar
              </Button>
              <Button type="submit" loading={enviando} full className="sm:w-auto">
                {modo === "WEBHOOK"
                  ? enviando
                    ? "Testando a conexão..."
                    : "Conectar e testar"
                  : enviando
                    ? "Abrindo o Bitrix24..."
                    : "Autorizar no Bitrix24"}
              </Button>
            </CardFooter>
          </form>
        ) : null}

        {etapa === 2 ? (
          <>
            <CardBody className="flex flex-col gap-5">
              <Alert tipo="sucesso" titulo="Conexão confirmada com o portal">
                Validamos a conexão com uma chamada real à API REST antes de
                salvar. Nada aqui é suposição.
              </Alert>

              <dl className="grid gap-3 sm:grid-cols-2">
                <ItemResumo rotulo="Portal" valor={conectado?.domain ?? "—"} />
                <ItemResumo
                  rotulo="Usuário do webhook"
                  valor={conectado?.nomeUsuario ?? "—"}
                />
                <ItemResumo rotulo="Modo" valor={MODO_WEBHOOK.titulo} />
                <ItemResumo
                  rotulo="Perfil no portal"
                  valor={
                    conectado?.admin
                      ? "Administrador"
                      : "Usuário comum do portal"
                  }
                />
              </dl>

              <Alert tipo="alerta" titulo="Lembrete sobre este modo">
                {avisoPermissaoWebhook(conectado?.nomeUsuario ?? null)}
              </Alert>
            </CardBody>

            <CardFooter>
              <Button
                variante="ghost"
                onClick={() => irPara(1)}
                className="sm:mr-auto"
              >
                Trocar a URL do webhook
              </Button>
              <Button
                onClick={() => router.push("/")}
                iconeDireita={<SetaDireita />}
                full
                className="sm:w-auto"
              >
                Começar a usar o aplicativo
              </Button>
            </CardFooter>
          </>
        ) : null}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- auxiliares */

interface CartaoModoProps {
  descricao: DescricaoModo;
  selecionado: boolean;
  refCartao: (elemento: HTMLDivElement | null) => void;
  onSelecionar: () => void;
  onNavegar: (direcao: 1 | -1) => void;
}

/**
 * Cartão selecionável no padrão `role="radio"`.
 *
 * Não é um <button> de propósito: o cartão contém listas de benefícios e
 * limitações, e <ul> dentro de <button> é HTML inválido. Em troca, Enter,
 * Espaço e as setas são tratados à mão, como exige o padrão ARIA.
 */
function CartaoModo({
  descricao,
  selecionado,
  refCartao,
  onSelecionar,
  onNavegar,
}: CartaoModoProps) {
  const recomendado = descricao.nivel === "recomendado";
  const idDescricao = `modo-${descricao.id}-descricao`;

  function aoTeclar(evento: React.KeyboardEvent<HTMLDivElement>) {
    if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      onSelecionar();
      return;
    }
    if (evento.key === "ArrowDown" || evento.key === "ArrowRight") {
      evento.preventDefault();
      onNavegar(1);
      return;
    }
    if (evento.key === "ArrowUp" || evento.key === "ArrowLeft") {
      evento.preventDefault();
      onNavegar(-1);
    }
  }

  return (
    <div
      ref={refCartao}
      role="radio"
      aria-checked={selecionado}
      aria-describedby={idDescricao}
      // Tabulação itinerante: o grupo inteiro é um único ponto de parada.
      tabIndex={selecionado ? 0 : -1}
      onClick={onSelecionar}
      onKeyDown={aoTeclar}
      className={cn(
        "cursor-pointer rounded-md border-2 bg-card p-4 transition-colors duration-150",
        selecionado
          ? "border-brand-500 bg-brand-50 shadow-sm"
          : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors duration-150",
            selecionado ? "border-brand-600" : "border-line-strong",
          )}
        >
          {selecionado ? (
            <span className="size-2.5 rounded-full bg-brand-600" />
          ) : null}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-strong">
              {descricao.titulo}
            </p>
            {recomendado ? (
              <Badge tom="sucesso" pontinho>
                Recomendado
              </Badge>
            ) : (
              <Badge tom="marca">Passo avançado</Badge>
            )}
            <Badge tom="neutro">{descricao.tempo}</Badge>
          </div>

          <p id={idDescricao} className="mt-1.5 text-sm text-body">
            {descricao.resumo}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Lista
              titulo={recomendado ? "O que você ganha" : "Benefícios extras"}
              itens={descricao.beneficios}
              tom="positivo"
            />
            <Lista
              titulo="O que considerar"
              itens={descricao.limitacoes}
              tom="atencao"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ListaProps {
  titulo: string;
  itens: string[];
  tom: "positivo" | "atencao";
}

function Lista({ titulo, itens, tom }: ListaProps) {
  const positivo = tom === "positivo";
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold tracking-wide text-soft uppercase">
        {titulo}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {itens.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-body">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                positivo ? "bg-success-500" : "bg-warning-500",
              )}
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PassosNoPortal({ passos }: { passos: string[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-strong">
        No seu Bitrix24, faça assim:
      </p>
      <ol className="mt-3 flex flex-col gap-3">
        {passos.map((passo, i) => (
          <li key={passo} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700"
            >
              {i + 1}
            </span>
            <span className="min-w-0 pt-0.5 text-sm text-body">{passo}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ItemResumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-muted/60 px-3.5 py-2.5">
      <dt className="text-xs font-medium tracking-wide text-soft uppercase">
        {rotulo}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-strong">
        {valor}
      </dd>
    </div>
  );
}

function SetaDireita() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
      <path d="M3 10a.75.75 0 0 1 .75-.75h9.19L9.47 5.78a.75.75 0 1 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06l3.47-3.47H3.75A.75.75 0 0 1 3 10Z" />
    </svg>
  );
}

function SetaEsquerda() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-4">
      <path d="M17 10a.75.75 0 0 1-.75.75H7.06l3.47 3.47a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 1 1 1.06 1.06L7.06 9.25h9.19A.75.75 0 0 1 17 10Z" />
    </svg>
  );
}
