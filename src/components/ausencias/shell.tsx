"use client";

/**
 * Moldura de todas as telas de ausências: selo de demonstração, "Ver
 * demonstração como…", navegação por perfil e a tela de entrada.
 * Sem MODO_DEMO=1 nada é exibido: ainda não existe identidade real.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ToastProvider } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api, type ContextoDemo, type ErroApi, type PessoaDemo } from "./api";
import { ProvedorAusencias, type ValorContexto } from "./contexto";
import { Carregando, ErroTela } from "./estados";
import { iniciais, ROTULO_PAPEL } from "./formatos";
import { useCarregar } from "./use-carregar";

interface ItemNav {
  href: string;
  rotulo: string;
}

function menuDoPapel(papel: PessoaDemo["papel"]): ItemNav[] {
  const base = "/ausencias";
  const meus = { href: `${base}/meus-pedidos`, rotulo: "Meus pedidos" };
  const pedir = { href: `${base}/pedir`, rotulo: "Pedir ausência" };
  if (papel === "colaborador") return [meus, pedir];
  const gestao = [
    { href: `${base}/aprovar`, rotulo: "Para aprovar" },
    { href: `${base}/calendario`, rotulo: "Calendário da equipe" },
    { href: `${base}/equipe`, rotulo: "Equipe disponível" },
  ];
  if (papel === "gestor") return [...gestao, meus, pedir];
  return [{ href: `${base}/admin`, rotulo: "Painel e configurações" }, ...gestao, meus, pedir];
}

function Avatar({ nome }: { nome: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700"
    >
      {iniciais(nome)}
    </span>
  );
}

function TelaEntrada({
  contexto,
  onEntrar,
  erro,
}: {
  contexto: ContextoDemo;
  onEntrar: (id: string) => void;
  erro: ErroApi | null;
}) {
  const grupos: { papel: PessoaDemo["papel"]; titulo: string }[] = [
    { papel: "colaborador", titulo: "Colaborador" },
    { papel: "gestor", titulo: "Gestor" },
    { papel: "admin", titulo: "Administrador" },
  ];
  return (
    <Card animado>
      <CardHeader
        titulo="Ver demonstração como…"
        descricao="Escolha uma pessoa fictícia para explorar o Revezza. Cada perfil enxerga e faz coisas diferentes."
      />
      <CardBody className="flex flex-col gap-6">
        {erro ? <Alert tipo="erro">{erro.mensagem}</Alert> : null}
        {grupos.map((g) => (
          <section key={g.papel} aria-labelledby={`grupo-${g.papel}`}>
            <h2 id={`grupo-${g.papel}`} className="text-sm font-semibold text-strong">
              {g.titulo}
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {contexto.pessoas
                .filter((p) => p.papel === g.papel)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onEntrar(p.id)}
                      className="flex w-full items-center gap-3 rounded-md border border-line bg-card px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <Avatar nome={p.nome} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-strong">{p.nome}</span>
                        <span className="block truncate text-xs text-soft">
                          {p.funcao ? `${p.funcao} · ` : ""}
                          {p.equipe}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </CardBody>
    </Card>
  );
}

function Moldura({ contexto, children }: { contexto: ContextoDemo; children: React.ReactNode }) {
  const [erro, setErro] = React.useState<ErroApi | null>(null);
  const [atual, setAtual] = React.useState<PessoaDemo | null>(contexto.atual);
  const pathname = usePathname();

  const trocarPara = React.useCallback(async (id: string): Promise<ErroApi | null> => {
    const r = await api.entrar(id);
    if (!r.ok) {
      setErro(r.erro);
      return r.erro;
    }
    setErro(null);
    setAtual(r.dados.pessoa);
    return null;
  }, []);

  const sair = React.useCallback(async () => {
    await api.sair();
    setAtual(null);
  }, []);

  if (!atual) {
    return <TelaEntrada contexto={contexto} onEntrar={(id) => void trocarPara(id)} erro={erro} />;
  }

  const valor: ValorContexto = {
    hoje: contexto.hoje,
    atual,
    pessoas: contexto.pessoas,
    selo: contexto.selo ?? "",
    trocarPara,
    sair,
  };
  const menu = menuDoPapel(atual.papel);

  return (
    <ProvedorAusencias value={valor}>
      <header className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-strong">Revezza</span>
            <Badge tom="alerta" pontinho>
              {valor.selo}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-soft">
              <span>Ver demonstração como</span>
              <select
                value={atual.id}
                onChange={(e) => void trocarPara(e.target.value)}
                className="h-11 min-h-11 rounded-md border border-line bg-card px-2 text-sm text-strong"
              >
                {contexto.pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} ({ROTULO_PAPEL[p.papel]})
                  </option>
                ))}
              </select>
            </label>
            <Button variante="ghost" tamanho="sm" onClick={() => void sair()}>
              Sair
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Avatar nome={atual.nome} />
          <p className="text-sm text-body">
            <strong className="text-strong">{atual.nome}</strong> · {ROTULO_PAPEL[atual.papel]} · {atual.equipe}
          </p>
        </div>
        {erro ? <Alert tipo="erro">{erro.mensagem}</Alert> : null}
        <nav aria-label="Telas de ausências">
          <ul className="flex flex-wrap gap-1 border-b border-line">
            {menu.map((item) => {
              const ativo = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={ativo ? "page" : undefined}
                    className={cn(
                      "br24-tap inline-flex items-center border-b-2 px-3 text-sm font-medium transition-colors",
                      ativo ? "border-brand-600 text-brand-700" : "border-transparent text-soft hover:text-strong",
                    )}
                  >
                    {item.rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      {/* A chave refaz as telas ao trocar de perfil: nenhum dado do perfil anterior sobra. */}
      <main id="conteudo" key={atual.id}>
        {children}
      </main>
    </ProvedorAusencias>
  );
}

export function ShellAusencias({ children }: { children: React.ReactNode }) {
  const buscar = React.useCallback(() => api.contexto(), []);
  const { estado, tentarDeNovo } = useCarregar(buscar);

  return (
    <ToastProvider>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {estado.status === "carregando" ? <Carregando rotulo="Abrindo o Revezza…" /> : null}
        {estado.status === "erro" ? <ErroTela erro={estado.erro} onTentarDeNovo={tentarDeNovo} /> : null}
        {estado.status === "pronto" && !estado.dados.modoDemo ? (
          <Card>
            <CardHeader titulo="Entrada indisponível" />
            <CardBody>
              <p className="text-sm text-body">
                O modo demonstração está desligado neste ambiente e a entrada com identidade verificada ainda não está
                disponível. Peça a quem administra o aplicativo para ligar o modo demonstração (somente com dados
                fictícios).
              </p>
            </CardBody>
          </Card>
        ) : null}
        {estado.status === "pronto" && estado.dados.modoDemo ? (
          <Moldura contexto={estado.dados}>{children}</Moldura>
        ) : null}
      </div>
    </ToastProvider>
  );
}
