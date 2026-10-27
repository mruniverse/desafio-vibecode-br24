"use client";

import * as React from "react";
import { Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader, Input, Textarea, useToast } from "@/components/ui";
import type { Etapa } from "@/lib/ausencias/tipos";
import { cn } from "@/lib/utils";
import { EmBreve, Seletor } from "./abas";
import { api } from "./api";
import { EstadoDaTela } from "./estados";
import { useCarregar } from "./use-carregar";

/** Variáveis que o servidor aceita nas mensagens (qualquer outra dá erro 422). */
const VARIAVEIS = ["nome", "periodo", "tipoPublico", "prazo"] as const;

const DESCRICAO_VARIAVEL: Record<(typeof VARIAVEIS)[number], string> = {
  nome: "nome da pessoa",
  periodo: "datas do pedido",
  tipoPublico: "tipo da ausência",
  prazo: "prazo do gestor",
};

/** Exemplo fictício usado só na prévia. */
const EXEMPLO: Record<(typeof VARIAVEIS)[number], string> = {
  nome: "Ana Ribeiro",
  periodo: "16/11 a 27/11",
  tipoPublico: "Férias anuais",
  prazo: "28/10 às 15:00",
};

const OPCOES_PRAZO: { horas: number; rotulo: string }[] = [
  { horas: 24, rotulo: "24 horas (1 dia)" },
  { horas: 48, rotulo: "48 horas (2 dias)" },
  { horas: 72, rotulo: "72 horas (3 dias)" },
  { horas: 96, rotulo: "96 horas (4 dias)" },
  { horas: 168, rotulo: "168 horas (7 dias)" },
];

const NOME_ETAPA: Record<Etapa["chave"], string> = {
  enviado: "Pedido enviado",
  com_gestor: "Com o gestor",
  confirmado: "Confirmado",
  recusado: "Recusado",
};

const QUANDO_ETAPA: Record<Etapa["chave"], string> = {
  enviado: "Assim que a pessoa envia o pedido.",
  com_gestor: "Enquanto o gestor decide.",
  confirmado: "Quando o pedido é aprovado.",
  recusado: "Quando o pedido é recusado.",
};

interface Rascunho {
  rotulo: string;
  mensagem: string;
  prazoHoras: number | null;
}

type Erros = Partial<Record<"rotulo" | "mensagem" | "prazoHoras", string>>;

function paraRascunho(e: Etapa): Rascunho {
  return { rotulo: e.rotulo, mensagem: e.mensagem, prazoHoras: e.prazoHoras ?? null };
}

function igual(a: Rascunho, b: Rascunho): boolean {
  return a.rotulo === b.rotulo && a.mensagem === b.mensagem && a.prazoHoras === b.prazoHoras;
}

function preencher(mensagem: string): string {
  return mensagem.replace(/\{([^}]*)\}/g, (inteiro, nome: string) =>
    (VARIAVEIS as readonly string[]).includes(nome) ? EXEMPLO[nome as (typeof VARIAVEIS)[number]] : inteiro,
  );
}

function validar(r: Rascunho): Erros {
  const erros: Erros = {};
  const rotulo = r.rotulo.trim();
  if (rotulo.length < 2) erros.rotulo = "Escreva pelo menos 2 letras.";
  else if (rotulo.length > 40) erros.rotulo = "Use no máximo 40 caracteres.";

  const msg = r.mensagem.trim();
  const desconhecidas = [...msg.matchAll(/\{([^}]*)\}/g)]
    .map((m) => m[1] ?? "")
    .filter((n) => !(VARIAVEIS as readonly string[]).includes(n));
  if (msg.length < 2) erros.mensagem = "Escreva pelo menos 2 letras.";
  else if (msg.length > 280) erros.mensagem = "Use no máximo 280 caracteres.";
  else if (desconhecidas.length > 0) {
    erros.mensagem = `A variável {${desconhecidas[0]}} não existe. Use só: ${VARIAVEIS.map((v) => `{${v}}`).join(", ")}.`;
  }
  return erros;
}

/* -------------------------------------------------------------------------- */

export function EtapasAdmin() {
  const buscar = React.useCallback(() => api.etapas(), []);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-soft">
        Defina o status que o colaborador acompanha e o aviso que ele recebe em cada etapa do pedido.
      </p>
      <EstadoDaTela estado={estado} onTentarDeNovo={tentarDeNovo} rotuloCarregando="Carregando as etapas…">
        {(etapas) => <Editor inicial={etapas} />}
      </EstadoDaTela>
    </div>
  );
}

function Editor({ inicial }: { inicial: Etapa[] }) {
  const toast = useToast();
  const [etapas, setEtapas] = React.useState<Etapa[]>(inicial);
  const [chave, setChave] = React.useState<Etapa["chave"]>(inicial[0]?.chave ?? "enviado");
  const [rascunhos, setRascunhos] = React.useState<Partial<Record<Etapa["chave"], Rascunho>>>({});
  const [salvando, setSalvando] = React.useState(false);
  const [erros, setErros] = React.useState<Erros>({});
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const etapa = etapas.find((e) => e.chave === chave) ?? etapas[0];
  if (!etapa) return null;

  const salvo = paraRascunho(etapa);
  const rascunho = rascunhos[etapa.chave] ?? salvo;
  const alterado = !igual(rascunho, salvo);
  const temPrazo = etapa.chave === "com_gestor";

  function mudar(parcial: Partial<Rascunho>) {
    if (!etapa) return;
    const chaveAtual = etapa.chave;
    setRascunhos((r) => ({ ...r, [chaveAtual]: { ...(r[chaveAtual] ?? paraRascunho(etapa)), ...parcial } }));
    setErros({});
    setErroGeral(null);
  }

  function escolher(nova: Etapa["chave"]) {
    setChave(nova);
    setErros({});
    setErroGeral(null);
  }

  function inserirVariavel(nome: string) {
    const texto = `{${nome}}`;
    const area = areaRef.current;
    const atual = rascunho.mensagem;
    if (!area) {
      mudar({ mensagem: `${atual}${texto}` });
      return;
    }
    const ini = area.selectionStart ?? atual.length;
    const fim = area.selectionEnd ?? atual.length;
    mudar({ mensagem: atual.slice(0, ini) + texto + atual.slice(fim) });
    const pos = ini + texto.length;
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(pos, pos);
    });
  }

  function descartar() {
    if (!etapa) return;
    const chaveAtual = etapa.chave;
    setRascunhos((r) => {
      const { [chaveAtual]: _descartado, ...resto } = r;
      void _descartado;
      return resto;
    });
    setErros({});
    setErroGeral(null);
  }

  async function salvar() {
    if (!etapa) return;
    const locais = validar(rascunho);
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      setErroGeral(null);
      return;
    }
    setSalvando(true);
    setErros({});
    setErroGeral(null);
    const r = await api.editarEtapa({
      chave: etapa.chave,
      rotulo: rascunho.rotulo.trim(),
      mensagem: rascunho.mensagem.trim(),
      ...(temPrazo && rascunho.prazoHoras !== null ? { prazoHoras: rascunho.prazoHoras } : {}),
    });
    setSalvando(false);
    if (r.ok) {
      setEtapas(r.dados);
      descartar();
      toast.sucesso("Etapa salva", { descricao: `“${rascunho.rotulo.trim()}” vale para os próximos pedidos.` });
      return;
    }
    const c = r.erro.campos;
    if (c && (c.rotulo || c.mensagem || c.prazoHoras)) {
      setErros({ rotulo: c.rotulo, mensagem: c.mensagem, prazoHoras: c.prazoHoras });
    } else {
      setErroGeral(r.erro.mensagem);
    }
  }

  const opcoesPrazo =
    rascunho.prazoHoras !== null && !OPCOES_PRAZO.some((o) => o.horas === rascunho.prazoHoras)
      ? [...OPCOES_PRAZO, { horas: rascunho.prazoHoras, rotulo: `${rascunho.prazoHoras} horas` }].sort((a, b) => a.horas - b.horas)
      : OPCOES_PRAZO;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Lista de etapas */}
      <Card className="self-start">
        <CardHeader nivel="h3" titulo="Etapas" />
        <CardBody className="flex flex-col gap-2">
          <ol className="flex flex-col gap-2">
            {etapas.map((e, i) => {
              const ativa = e.chave === etapa.chave;
              const pendente = rascunhos[e.chave] !== undefined && !igual(rascunhos[e.chave] as Rascunho, paraRascunho(e));
              return (
                <li key={e.chave}>
                  <button
                    type="button"
                    onClick={() => escolher(e.chave)}
                    aria-current={ativa ? "step" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors duration-150",
                      ativa ? "border-brand-500 bg-brand-50" : "border-line bg-card hover:bg-muted",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                        ativa ? "bg-brand-600 text-white" : "bg-muted text-body",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-strong">{NOME_ETAPA[e.chave]}</span>
                      <span className="block truncate text-xs text-soft">
                        {pendente ? "Alterações não salvas" : e.rotulo}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button variante="ghost" tamanho="sm" disabled aria-describedby="etapas-breve">
              + Adicionar etapa
            </Button>
            <span id="etapas-breve">
              <EmBreve />
            </span>
          </div>
          <p className="text-xs text-soft">Adicionar, remover e reordenar etapas chegam em breve.</p>
        </CardBody>
      </Card>

      <div className="flex min-w-0 flex-col gap-5">
        {/* Formulário */}
        <Card>
          <CardHeader
            nivel="h3"
            titulo={`Etapa: ${NOME_ETAPA[etapa.chave]}`}
            descricao={QUANDO_ETAPA[etapa.chave]}
          />
          <CardBody className="flex flex-col gap-4">
            {erroGeral ? (
              <Alert tipo="erro" titulo="Não foi possível salvar">
                {erroGeral}
              </Alert>
            ) : null}

            <Input
              rotulo="Status que o colaborador vê"
              obrigatorio
              value={rascunho.rotulo}
              maxLength={40}
              onChange={(e) => mudar({ rotulo: e.target.value })}
              erro={erros.rotulo}
              ajuda={`${rascunho.rotulo.length} de 40 caracteres.`}
            />

            {temPrazo ? (
              <Seletor
                rotulo="Prazo para o gestor responder"
                value={rascunho.prazoHoras === null ? "" : String(rascunho.prazoHoras)}
                onChange={(e) => mudar({ prazoHoras: e.target.value === "" ? null : Number(e.target.value) })}
                erro={erros.prazoHoras}
                ajuda="Depois desse prazo o pedido aparece como atrasado no painel."
              >
                {rascunho.prazoHoras === null ? <option value="">Escolha um prazo</option> : null}
                {opcoesPrazo.map((o) => (
                  <option key={o.horas} value={o.horas}>
                    {o.rotulo}
                  </option>
                ))}
              </Seletor>
            ) : null}

            <div className="flex flex-col gap-2">
              <Textarea
                ref={areaRef}
                rotulo="Aviso que a pessoa recebe"
                obrigatorio
                rows={4}
                value={rascunho.mensagem}
                maxLength={280}
                onChange={(e) => mudar({ mensagem: e.target.value })}
                erro={erros.mensagem}
                ajuda={`${rascunho.mensagem.length} de 280 caracteres.`}
              />
              <div role="group" aria-label="Inserir variável na mensagem" className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-soft">Inserir:</span>
                {VARIAVEIS.map((v) => (
                  <Button
                    key={v}
                    variante="secondary"
                    tamanho="sm"
                    onClick={() => inserirVariavel(v)}
                    aria-label={`Inserir ${DESCRICAO_VARIAVEL[v]}, variável ${v}`}
                  >
                    {`{${v}}`}
                  </Button>
                ))}
              </div>
            </div>
          </CardBody>
          <CardFooter>
            <p role="status" aria-live="polite" className="text-sm text-soft sm:mr-auto">
              {salvando ? "Salvando…" : alterado ? "Há alterações não salvas." : "Tudo salvo."}
            </p>
            <Button variante="ghost" onClick={descartar} disabled={!alterado || salvando}>
              Descartar alterações
            </Button>
            <Button onClick={() => void salvar()} loading={salvando} disabled={!alterado}>
              Salvar etapa
            </Button>
          </CardFooter>
        </Card>

        {/* Prévia */}
        <Card>
          <CardHeader
            nivel="h3"
            titulo="Como o colaborador acompanha"
            descricao="Prévia com um pedido de exemplo parado nesta etapa. As mudanças valem para os próximos pedidos."
          />
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-3">
              <p className="text-sm text-strong">
                {EXEMPLO.tipoPublico} · {EXEMPLO.periodo}
              </p>
              <Badge tom={etapa.chave === "recusado" ? "perigo" : etapa.chave === "confirmado" ? "sucesso" : "alerta"} pontinho tamanho="md">
                {rascunho.rotulo.trim() || "Sem nome"}
              </Badge>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-strong">Aviso que a pessoa recebe</h4>
              <div className="mt-2 rounded-md border border-line bg-muted px-4 py-3">
                <p className="text-xs font-semibold text-brand-700">Revezza</p>
                <p className="mt-1 break-words text-sm text-body">{preencher(rascunho.mensagem) || "Escreva a mensagem acima."}</p>
              </div>
              <p className="mt-2 text-xs text-soft">
                Exemplo fictício: {VARIAVEIS.map((v) => `{${v}} = ${EXEMPLO[v]}`).join(" · ")}.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
