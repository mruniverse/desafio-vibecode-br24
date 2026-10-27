"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  Input,
  Skeleton,
  Textarea,
  useToast,
} from "@/components/ui";
import type { BadgeTom } from "@/components/ui";
import type { Carteira, Equipe, Tipo } from "@/lib/ausencias/tipos";
import type { PessoaVisao, SincronizacaoLogVisao } from "@/lib/ausencias/visoes";
import { cn } from "@/lib/utils";
import { EmBreve, Seletor } from "./abas";
import { api, type ErroApi } from "./api";
import { useAusencias } from "./contexto";
import { ErroTela } from "./estados";
import { plural, primeiroDiaDoMes, ultimoDiaDoMes } from "./formatos";
import { useCarregar } from "./use-carregar";

/** Cartão de seção com estado de carregamento/erro próprio (uma seção que falha não derruba as outras). */
function Secao<T>({
  titulo,
  descricao,
  estado,
  onTentarDeNovo,
  children,
}: {
  titulo: string;
  descricao?: string;
  estado: { status: "carregando" } | { status: "erro"; erro: ErroApi } | { status: "pronto"; dados: T };
  onTentarDeNovo: () => void;
  children: (dados: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader nivel="h3" titulo={titulo} descricao={descricao} />
      {estado.status === "carregando" ? (
        <CardBody aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
          <span className="sr-only">Carregando {titulo.toLowerCase()}…</span>
          <Skeleton altura="2.5rem" />
          <Skeleton altura="2.5rem" />
        </CardBody>
      ) : null}
      {estado.status === "erro" ? (
        <CardBody>
          <ErroTela erro={estado.erro} onTentarDeNovo={onTentarDeNovo} />
        </CardBody>
      ) : null}
      {estado.status === "pronto" ? children(estado.dados) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* (a) Bitrix24                                                               */
/* -------------------------------------------------------------------------- */

const PLANOS: { plano: string; efeito: string }[] = [
  { plano: "Free ou Essencial", efeito: "Sem integração com o Gráfico de Ausências." },
  { plano: "Basic ou Standard (Vibe+)", efeito: "Pedidos aprovados aparecem no calendário da pessoa no Bitrix24." },
  {
    plano: "Professional (Vibe+) ou superior",
    efeito: "Pedidos aprovados aparecem no Gráfico de Ausências. Sincronização nos dois sentidos: em breve.",
  },
];

const ESTADO_SINC: Record<string, { rotulo: string; tom: BadgeTom }> = {
  ok: { rotulo: "Enviado", tom: "sucesso" },
  falha: { rotulo: "Falhou", tom: "perigo" },
  falha_manual: { rotulo: "Falhou", tom: "perigo" },
  removido: { rotulo: "Removido", tom: "neutro" },
  pendente: { rotulo: "Na fila", tom: "alerta" },
  em_andamento: { rotulo: "Enviando", tom: "alerta" },
  remocao_pendente: { rotulo: "Remoção na fila", tom: "alerta" },
};

function quandoLegivel(instante: string): string {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return instante.slice(0, 10);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", " às");
}

const falhou = (l: SincronizacaoLogVisao) => l.estado === "falha" || l.estado === "falha_manual";

function SecaoBitrix() {
  const toast = useToast();
  const buscar = React.useCallback(() => api.logSincronizacao(), []);
  const { estado, recarregar, tentarDeNovo } = useCarregar(buscar);
  const [reprocessando, setReprocessando] = React.useState<number | "todas" | null>(null);

  async function reprocessar(pedidoId?: number) {
    setReprocessando(pedidoId ?? "todas");
    const r = await api.reprocessar(pedidoId);
    setReprocessando(null);
    if (r.ok) {
      toast.sucesso(pedidoId === undefined ? "Reprocessando as sincronizações com falha" : "Sincronização reenviada");
      recarregar();
    } else {
      toast.erro("Não foi possível reprocessar", { descricao: r.erro.mensagem });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader nivel="h3" titulo="Bitrix24" descricao="Como o Revezza conversa com o seu portal." />
        <CardBody className="flex flex-col gap-4">
          <Alert tipo="info" titulo="Conexão">
            Modo demonstração com Bitrix24 simulado (nenhuma escrita no portal real).
          </Alert>
          <div>
            <h4 className="text-sm font-semibold text-strong">O que muda em cada plano do Bitrix24</h4>
            <ul className="mt-2 flex flex-col gap-2">
              {PLANOS.map((p) => (
                <li key={p.plano} className="rounded-md border border-line px-3 py-2">
                  <p className="text-sm font-medium text-strong">{p.plano}</p>
                  <p className="text-sm text-soft">{p.efeito}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-muted px-3 py-2">
            <p className="text-sm font-medium text-strong">Google Agenda</p>
            <EmBreve />
            <p className="w-full text-sm text-soft">Avisar quem marcar reunião com alguém que estará ausente.</p>
          </div>
        </CardBody>
      </Card>

      <Secao
        titulo="Últimas sincronizações"
        descricao="O que o Revezza enviou ao calendário do Bitrix24."
        estado={estado}
        onTentarDeNovo={tentarDeNovo}
      >
        {(log) => {
          const comFalha = log.filter(falhou).length;
          if (log.length === 0) {
            return <EmptyState titulo="Nenhuma sincronização ainda." descricao="Quando um pedido for aprovado, ele aparece aqui." />;
          }
          return (
            <>
              <ul className="divide-y divide-line">
                {log.map((l) => {
                  const e = ESTADO_SINC[l.estado] ?? { rotulo: l.estado, tom: "neutro" as BadgeTom };
                  return (
                    <li
                      key={`${l.pedidoId}-${l.operacao}-${l.quando}`}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-strong">
                          Pedido nº {l.pedidoId} · {l.operacao === "adicionar" ? "adicionar ao calendário" : "remover do calendário"}
                        </p>
                        <p className="text-sm text-soft">
                          {quandoLegivel(l.quando)} · {plural(l.tentativas, "tentativa", "tentativas")}
                        </p>
                        {l.erro ? <p className="text-sm text-danger-700">{l.erro}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tom={e.tom} pontinho>
                          {e.rotulo}
                        </Badge>
                        {falhou(l) ? (
                          <Button
                            variante="secondary"
                            tamanho="sm"
                            loading={reprocessando === l.pedidoId}
                            disabled={reprocessando !== null}
                            onClick={() => void reprocessar(l.pedidoId)}
                            aria-label={`Reprocessar a sincronização do pedido ${l.pedidoId}`}
                          >
                            Reprocessar
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {comFalha > 0 ? (
                <CardFooter>
                  <p className="text-sm text-soft sm:mr-auto">{plural(comFalha, "sincronização falhou", "sincronizações falharam")}.</p>
                  <Button
                    variante="secondary"
                    loading={reprocessando === "todas"}
                    disabled={reprocessando !== null}
                    onClick={() => void reprocessar()}
                  >
                    Reprocessar todas
                  </Button>
                </CardFooter>
              ) : null}
            </>
          );
        }}
      </Secao>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* (b) Mínimo por equipe                                                      */
/* -------------------------------------------------------------------------- */

function LinhaEquipe({ equipe, onSalvo }: { equipe: Equipe; onSalvo: (e: Equipe) => void }) {
  const toast = useToast();
  const [salvando, setSalvando] = React.useState(false);
  const idRotulo = React.useId();

  async function salvar(minimoPessoas: number, contarPendentes: boolean) {
    setSalvando(true);
    const r = await api.definirMinimo(equipe.id, { minimoPessoas, contarPendentes });
    setSalvando(false);
    if (r.ok) {
      onSalvo(r.dados);
      toast.sucesso(`Equipe ${equipe.nome} atualizada`, {
        descricao: `Mínimo de ${plural(r.dados.minimoPessoas, "pessoa", "pessoas")}.`,
      });
    } else {
      toast.erro("Não foi possível salvar", { descricao: r.erro.campos?.minimoPessoas ?? r.erro.mensagem });
    }
  }

  const botao =
    "grid size-11 min-h-11 place-items-center rounded-md border border-line-strong bg-card text-lg font-semibold text-strong transition-colors duration-150 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p id={idRotulo} className="text-sm font-medium text-strong">
        {equipe.nome}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div role="group" aria-labelledby={idRotulo} className="flex items-center gap-2">
          <button
            type="button"
            className={botao}
            disabled={salvando || equipe.minimoPessoas <= 1}
            onClick={() => void salvar(equipe.minimoPessoas - 1, equipe.contarPendentes)}
            aria-label={`Diminuir o mínimo de pessoas da equipe ${equipe.nome}`}
          >
            <span aria-hidden="true">−</span>
          </button>
          <span className="min-w-24 text-center text-sm text-strong" aria-live="polite">
            <span className="text-lg font-semibold">{equipe.minimoPessoas}</span>{" "}
            {equipe.minimoPessoas === 1 ? "pessoa" : "pessoas"}
          </span>
          <button
            type="button"
            className={botao}
            disabled={salvando || equipe.minimoPessoas >= 500}
            onClick={() => void salvar(equipe.minimoPessoas + 1, equipe.contarPendentes)}
            aria-label={`Aumentar o mínimo de pessoas da equipe ${equipe.nome}`}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={equipe.contarPendentes}
          disabled={salvando}
          onClick={() => void salvar(equipe.minimoPessoas, !equipe.contarPendentes)}
          className="flex min-h-11 items-center gap-3 rounded-md text-left disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className={cn(
              "relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors duration-150",
              equipe.contarPendentes ? "bg-brand-600" : "bg-line-strong",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-card shadow-sm transition-[left] duration-150",
                equipe.contarPendentes ? "left-[1.375rem]" : "left-0.5",
              )}
            />
          </span>
          <span className="text-sm text-body">Contar pedidos em análise como ausência</span>
        </button>
      </div>
    </li>
  );
}

function SecaoMinimo() {
  const buscar = React.useCallback(() => api.equipes(), []);
  const { estado, tentarDeNovo } = useCarregar(buscar);
  const [alteradas, setAlteradas] = React.useState<Record<string, Equipe>>({});

  return (
    <Secao
      titulo="Mínimo por equipe"
      descricao="Quantas pessoas precisam estar trabalhando. Abaixo disso, o calendário avisa o gestor."
      estado={estado}
      onTentarDeNovo={tentarDeNovo}
    >
      {(equipes) =>
        equipes.length === 0 ? (
          <EmptyState titulo="Nenhuma equipe cadastrada." />
        ) : (
          <ul className="divide-y divide-line">
            {equipes.map((e) => (
              <LinhaEquipe
                key={e.id}
                equipe={alteradas[e.id] ?? e}
                onSalvo={(nova) => setAlteradas((a) => ({ ...a, [nova.id]: nova }))}
              />
            ))}
          </ul>
        )
      }
    </Secao>
  );
}

/* -------------------------------------------------------------------------- */
/* (c) Creditar dias                                                          */
/* -------------------------------------------------------------------------- */

interface GrupoPessoas {
  equipe: Equipe;
  pessoas: PessoaVisao[];
}

type CamposCredito = "pessoaId" | "carteira" | "dias" | "motivo" | "venceEm";

function SecaoCreditar() {
  const { hoje, atual } = useAusencias();
  const toast = useToast();
  const buscar = React.useCallback(async () => {
    const eq = await api.equipes();
    if (!eq.ok) return eq;
    const cals = await Promise.all(
      eq.dados.map((e) => api.calendario(e.id, primeiroDiaDoMes(hoje), ultimoDiaDoMes(hoje))),
    );
    const grupos: GrupoPessoas[] = [];
    for (let i = 0; i < eq.dados.length; i += 1) {
      const cal = cals[i];
      const equipe = eq.dados[i];
      if (!cal || !equipe) continue;
      if (!cal.ok) return cal;
      grupos.push({ equipe, pessoas: cal.dados.pessoas });
    }
    return { ok: true as const, dados: grupos };
  }, [hoje]);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  const [pessoaId, setPessoaId] = React.useState("");
  const [carteira, setCarteira] = React.useState<Carteira>("ferias");
  const [dias, setDias] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [venceEm, setVenceEm] = React.useState("");
  const [erros, setErros] = React.useState<Partial<Record<CamposCredito, string>>>({});
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    const locais: Partial<Record<CamposCredito, string>> = {};
    const n = Number(dias);
    if (!pessoaId) locais.pessoaId = "Escolha uma pessoa da lista.";
    if (!Number.isInteger(n) || n < 1 || n > 60) locais.dias = "Informe um número inteiro de 1 a 60.";
    const m = motivo.trim();
    if (m.length < 10) locais.motivo = "Explique em pelo menos 10 caracteres.";
    else if (m.length > 300) locais.motivo = "Use no máximo 300 caracteres.";
    setErroGeral(null);
    if (Object.keys(locais).length > 0) {
      setErros(locais);
      return;
    }
    setErros({});
    setSalvando(true);
    const r = await api.creditar({ pessoaId, carteira, dias: n, motivo: m, ...(venceEm ? { venceEm } : {}) });
    setSalvando(false);
    if (r.ok) {
      toast.sucesso("Dias creditados", { descricao: `${plural(n, "dia", "dias")} de ${carteira === "ferias" ? "férias" : "folga"} lançados.` });
      setDias("");
      setMotivo("");
      setVenceEm("");
      return;
    }
    const c = r.erro.campos;
    if (c && Object.keys(c).length > 0) {
      setErros({ pessoaId: c.pessoaId, carteira: c.carteira, dias: c.dias, motivo: c.motivo, venceEm: c.venceEm });
    } else {
      setErroGeral(r.erro.mensagem);
    }
  }

  return (
    <Secao
      titulo="Creditar dias"
      descricao="Some dias de férias ou folga ao saldo de uma pessoa. Você não pode creditar para si mesmo."
      estado={estado}
      onTentarDeNovo={tentarDeNovo}
    >
      {(grupos) => (
        <form onSubmit={(e) => void enviar(e)} noValidate>
          <CardBody className="flex flex-col gap-4">
            {erroGeral ? (
              <Alert tipo="erro" titulo="Não foi possível creditar">
                {erroGeral}
              </Alert>
            ) : null}
            <Seletor
              rotulo="Pessoa"
              obrigatorio
              value={pessoaId}
              onChange={(e) => setPessoaId(e.target.value)}
              erro={erros.pessoaId}
            >
              <option value="">Escolha a pessoa</option>
              {grupos
                .map((g) => ({ ...g, pessoas: g.pessoas.filter((p) => p.id !== atual.id) }))
                .filter((g) => g.pessoas.length > 0)
                .map((g) => (
                  <optgroup key={g.equipe.id} label={g.equipe.nome}>
                    {g.pessoas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </Seletor>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Seletor
                rotulo="Tipo de saldo"
                obrigatorio
                value={carteira}
                onChange={(e) => setCarteira(e.target.value === "folga" ? "folga" : "ferias")}
                erro={erros.carteira}
              >
                <option value="ferias">Férias</option>
                <option value="folga">Folga</option>
              </Seletor>
              <Input
                rotulo="Quantos dias"
                obrigatorio
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                step={1}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                erro={erros.dias}
                ajuda="De 1 a 60 dias."
              />
            </div>
            <Textarea
              rotulo="Motivo"
              obrigatorio
              rows={3}
              maxLength={300}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              erro={erros.motivo}
              ajuda={`Fica registrado no histórico. ${motivo.trim().length} de 300 caracteres (mínimo 10).`}
            />
            <Input
              rotulo="Vence em (opcional)"
              type="date"
              value={venceEm}
              onChange={(e) => setVenceEm(e.target.value)}
              erro={erros.venceEm}
              ajuda="Deixe em branco se esses dias não vencem."
              classNameRaiz="sm:max-w-xs"
            />
          </CardBody>
          <CardFooter>
            <Button type="submit" loading={salvando}>
              Creditar dias
            </Button>
          </CardFooter>
        </form>
      )}
    </Secao>
  );
}

/* -------------------------------------------------------------------------- */
/* (d) Tipos de ausência (somente leitura)                                    */
/* -------------------------------------------------------------------------- */

function SecaoTipos() {
  const buscar = React.useCallback(() => api.tipos(), []);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  return (
    <Secao
      titulo="Tipos de ausência"
      descricao="Só consulta por enquanto: criar e editar tipos chega em breve."
      estado={estado}
      onTentarDeNovo={tentarDeNovo}
    >
      {(tipos: Tipo[]) =>
        tipos.length === 0 ? (
          <EmptyState titulo="Nenhum tipo cadastrado." />
        ) : (
          <ul className="divide-y divide-line">
            {tipos.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 rounded-full border border-line-strong"
                  style={{ backgroundColor: t.cor }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-strong">{t.nome}</p>
                  <p className="text-sm text-soft">
                    {t.quemPede === "admin" ? "Só o administrador lança" : "Todas as pessoas"} ·{" "}
                    {t.consomeSaldo === "ferias"
                      ? "Usa saldo de férias"
                      : t.consomeSaldo === "folga"
                        ? "Usa saldo de folga"
                        : "Não usa saldo"}
                  </p>
                  {t.sensivel ? (
                    <p className="mt-1">
                      <Badge tom="alerta">Dado sensível: aparece como Ausência para o gestor e colegas</Badge>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </Secao>
  );
}

/* -------------------------------------------------------------------------- */
/* (e) Quem vê o quê (somente leitura)                                        */
/* -------------------------------------------------------------------------- */

const MATRIZ: { acao: string; colaborador: string; gestor: string; admin: string }[] = [
  { acao: "Criar pedido para si", colaborador: "Sim", gestor: "Sim", admin: "Sim" },
  { acao: "Ver pedidos", colaborador: "Só os próprios", gestor: "Da equipe e os próprios", admin: "Todos" },
  {
    acao: "Aprovar ou recusar",
    colaborador: "Não",
    gestor: "Só da equipe, nunca o próprio",
    admin: "Todos; o próprio só por outro administrador",
  },
  { acao: "Cancelar", colaborador: "A própria, só antes do início", gestor: "Da equipe", admin: "Todos" },
  { acao: "Creditar dias", colaborador: "Não", gestor: "Da equipe, nunca a si", admin: "Todos, nunca a si" },
  { acao: "Editar etapas e tipos", colaborador: "Não", gestor: "Não", admin: "Sim" },
  { acao: "Mínimo de pessoas", colaborador: "Não", gestor: "Da própria equipe", admin: "De todas as equipes" },
  { acao: "Painel", colaborador: "Não", gestor: "Da equipe", admin: "Da empresa" },
  { acao: "Motivo de ausência sensível", colaborador: "Só o próprio", gestor: "Não vê", admin: "Sim" },
];

function SecaoMatriz() {
  return (
    <Card>
      <CardHeader
        nivel="h3"
        titulo="Quem vê o quê"
        descricao="Só consulta. Os perfis seguem as permissões do Bitrix24 e os gestores vêm da estrutura da empresa."
      />
      <CardBody className="px-0 sm:px-0">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">O que cada perfil pode fazer no Revezza</caption>
          <thead>
            <tr className="border-b border-line bg-muted">
              <th scope="col" className="w-[28%] px-3 py-2 font-semibold text-strong sm:px-5">
                O que pode fazer
              </th>
              <th scope="col" className="px-2 py-2 font-semibold text-strong">
                Colaborador
              </th>
              <th scope="col" className="px-2 py-2 font-semibold text-strong">
                Gestor
              </th>
              <th scope="col" className="px-2 py-2 font-semibold text-strong">
                Administrador
              </th>
            </tr>
          </thead>
          <tbody>
            {MATRIZ.map((linha) => (
              <tr key={linha.acao} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="break-words px-3 py-2 font-medium text-strong sm:px-5">
                  {linha.acao}
                </th>
                <td className="break-words px-2 py-2 text-body">{linha.colaborador}</td>
                <td className="break-words px-2 py-2 text-body">{linha.gestor}</td>
                <td className="break-words px-2 py-2 text-body">{linha.admin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

export function ConfiguracoesAdmin() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-soft">Conexão com o Bitrix24, mínimo por equipe, saldos, tipos de ausência e permissões.</p>
      <SecaoBitrix />
      <SecaoMinimo />
      <SecaoCreditar />
      <SecaoTipos />
      <SecaoMatriz />
      <p className="text-sm text-soft">
        Regras de férias da CLT, acessos extras de gestor e criação de tipos: <EmBreve />
      </p>
    </div>
  );
}
