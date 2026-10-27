/**
 * `paraVisao`: UNICO caminho de saida de DTO de pedido (BR24-005 v2.2).
 *
 *  - tipo sensivel: ROTULO_PUBLICO_SENSIVEL para quem nao e dono nem admin;
 *  - `motivoPrivado`: so dono/admin (o repositorio ja decifra so para eles;
 *    aqui e a 2a barreira — nunca confia no que veio);
 *  - `justificativa`: dono, admin, ou tipo comum (tipo sensivel nao a tem);
 *  - `permitido{cancelar,decidir}` calculado por `autorizacao.ts` — a UI so
 *    desenha o que vier daqui.
 *
 * O papel usado e o do BANCO (`SessaoResolvida`), nunca o do cookie.
 */
import { podeCancelar, podeDecidir } from "./autorizacao";
import type { SessaoResolvida } from "./sessao";
import type { ChaveEtapa, DataISO, Equipe, Etapa, Pedido, Pessoa, Tipo } from "./tipos";
import { ROTULO_PUBLICO_SENSIVEL } from "./tipos";
import type { PedidoVisao, PessoaVisao } from "./visoes";

/** Dados de referencia (pequenos) carregados uma vez por operacao. */
export interface DadosVisao {
  pessoas: ReadonlyMap<string, Pessoa>;
  tipos: ReadonlyMap<string, Tipo>;
  etapas: readonly Etapa[];
  equipes: readonly Equipe[];
  hoje: DataISO;
}

export function paraVisaoPessoa(p: Pessoa): PessoaVisao {
  const v: PessoaVisao = { id: p.id, nome: p.nome, equipeId: p.equipeId, papel: p.papel };
  if (p.funcao !== undefined) v.funcao = p.funcao;
  return v;
}

export function etapaDoPedido(p: Pick<Pedido, "status">): ChaveEtapa {
  if (p.status === "pendente") return "com_gestor";
  if (p.status === "aprovada") return "confirmado";
  if (p.status === "recusada") return "recusado";
  return "enviado";
}

export function paraVisao(pedido: Pedido, sessao: SessaoResolvida, dados: DadosVisao): PedidoVisao {
  const dona = dados.pessoas.get(pedido.pessoaId);
  const tipo = dados.tipos.get(pedido.tipoId);
  if (!dona || !tipo) throw new Error(`pedido ${pedido.id}: pessoa ou tipo sem cadastro`);

  const eu = sessao.pessoa;
  const ehDono = pedido.pessoaId === eu.id;
  const ehAdmin = sessao.papel === "admin";
  const veTudo = ehDono || ehAdmin;
  const etapa = etapaDoPedido(pedido);
  const aprovador = dados.pessoas.get(dona.aprovadorId);
  const eu2 = { id: eu.id, papel: sessao.papel, equipeId: eu.equipeId, aprovadorId: eu.aprovadorId };

  const v: PedidoVisao = {
    id: pedido.id,
    pessoa: paraVisaoPessoa(dona),
    tipo: tipo.sensivel && !veTudo ? ROTULO_PUBLICO_SENSIVEL : tipo.nome,
    tipoSensivel: tipo.sensivel,
    inicio: pedido.inicio,
    fim: pedido.fim,
    diasUteis: pedido.diasUteis,
    status: pedido.status,
    sincronizacao: pedido.sincronizacao,
    etapa,
    etapaRotulo:
      pedido.status === "cancelada" ? "Cancelado" : (dados.etapas.find((e) => e.chave === etapa)?.rotulo ?? etapa),
    excedeSaldo: pedido.excedeSaldo,
    criadoEm: pedido.criadoEm,
    versao: pedido.versao,
    permitido: {
      cancelar: podeCancelar(eu2, dona, pedido, dados.hoje, dados.equipes),
      decidir: podeDecidir(eu2, dona, pedido, dados.equipes),
    },
  };
  if (pedido.justificativa !== undefined && (veTudo || !tipo.sensivel)) v.justificativa = pedido.justificativa;
  if (pedido.motivoPrivado !== undefined && veTudo) v.motivoPrivado = pedido.motivoPrivado;
  if (pedido.motivoDecisao !== undefined) v.motivoDecisao = pedido.motivoDecisao;
  if (pedido.sugestao !== undefined) v.sugestao = { inicio: pedido.sugestao.inicio, fim: pedido.sugestao.fim };
  if (pedido.prazoEm !== undefined && pedido.status === "pendente") v.prazoEm = pedido.prazoEm;
  if (aprovador) v.aprovador = paraVisaoPessoa(aprovador);
  return v;
}
