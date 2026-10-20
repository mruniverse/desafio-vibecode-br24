/**
 * Modos de conexao com o Bitrix24, descritos para a interface.
 *
 * Centraliza o texto e os beneficios de cada modo para que o wizard, a tela de
 * configuracoes e os materiais de publicacao contem a MESMA historia — e para
 * que a ressalva de permissao do webhook nunca seja esquecida numa tela.
 */

export interface DescricaoModo {
  id: "WEBHOOK" | "OAUTH";
  titulo: string;
  resumo: string;
  /** Tempo realista de configuracao, para calibrar a expectativa. */
  tempo: string;
  nivel: "recomendado" | "avancado";
  beneficios: string[];
  limitacoes: string[];
  /** Passo a passo que o cliente segue DENTRO do Bitrix24. */
  passosNoPortal: string[];
}

export const MODO_WEBHOOK: DescricaoModo = {
  id: "WEBHOOK",
  titulo: "Webhook de entrada",
  resumo:
    "O caminho mais rapido: voce gera uma URL no seu Bitrix24 e cola aqui. Nao expira e nao exige cadastrar aplicativo.",
  tempo: "cerca de 1 minuto",
  nivel: "recomendado",
  beneficios: [
    "Configuracao em um unico campo, sem sair do assistente",
    "A conexao nao expira: nao ha reautorizacao periodica",
    "Voce escolhe exatamente quais permissoes liberar ao gerar a URL",
  ],
  limitacoes: [
    "As acoes no Bitrix24 sao executadas em nome do usuario que gerou o webhook, nao de quem esta usando o aplicativo",
  ],
  passosNoPortal: [
    "No seu Bitrix24, abra o menu Aplicativos.",
    "Va em Webhooks e escolha Webhook de entrada.",
    "Marque apenas as permissoes que o aplicativo precisa (o assistente informa quais).",
    "Salve e copie a URL gerada.",
    "Cole a URL no campo abaixo.",
  ],
};

export const MODO_OAUTH: DescricaoModo = {
  id: "OAUTH",
  titulo: "Aplicativo local (OAuth)",
  resumo:
    "Modo avancado: cada pessoa autoriza o aplicativo com o proprio usuario do Bitrix24. Da mais controle, exige alguns passos a mais.",
  tempo: "cerca de 5 minutos",
  nivel: "avancado",
  beneficios: [
    "Respeita as permissoes de cada usuario: ninguem ve o que nao poderia ver no Bitrix24",
    "Identifica quem esta usando o aplicativo, permitindo registro de quem fez cada acao",
    "Autorizacao revogavel pelo portal a qualquer momento, sem trocar URL",
    "Habilita o uso do aplicativo embarcado dentro do Bitrix24 (widgets)",
  ],
  limitacoes: [
    "Exige cadastrar um aplicativo local no portal e informar duas credenciais",
    "A autorizacao e renovada automaticamente, mas depende do aplicativo continuar ativo no portal",
  ],
  passosNoPortal: [
    "No seu Bitrix24, abra Aplicativos > Desenvolvedores.",
    "Escolha Outro e depois Aplicativo local.",
    "Cole a URL de redirecionamento que o assistente mostra.",
    "Marque as permissoes necessarias e salve.",
    "Copie o ID e a chave secreta para os campos do assistente.",
  ],
};

export const MODOS: DescricaoModo[] = [MODO_WEBHOOK, MODO_OAUTH];

/**
 * Aviso exibido sempre que o portal estiver conectado por webhook.
 * Honestidade sobre o modelo de permissao e requisito do desafio, nao detalhe.
 */
export function avisoPermissaoWebhook(nomeUsuario?: string | null): string {
  const dono = nomeUsuario?.trim() ? `"${nomeUsuario.trim()}"` : "que gerou o webhook";
  return (
    `Neste modo, as consultas e acoes no Bitrix24 sao feitas em nome do usuario ${dono}. ` +
    "Quem abrir este aplicativo vera os dados que esse usuario pode ver. " +
    "Para que cada pessoa acesse apenas o que lhe cabe, use o modo Aplicativo local (OAuth)."
  );
}
