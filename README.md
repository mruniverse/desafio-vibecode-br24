# Aplicativo Br24 — Desafio Vibecode

Aplicativo integrado ao **Bitrix24** pela API REST oficial, hospedado na
**Onnira Cloud AI**. Desenvolvido para o Desafio Vibecode Br24 (Atomic Group).

**Dupla:** Yuri Luz e Tiago Duarte
**Nosso diferencial:** facilidade de uso — interface intuitiva, em portugues,
responsiva, com configuracao guiada que qualquer cliente conclui sozinho.

> O tema/aplicacao especifica e sorteada em 21/10 as 16h. Este repositorio ja
> contem a base tecnica completa (integracao, seguranca, banco, UI, deploy);
> o dominio do problema entra em cima dela.

---

## Stack

| Camada | Escolha | Por que |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript strict | Exigencia do desafio (Next.js/Node.js); App Router renderiza no servidor e nunca expoe token ao navegador |
| Estilo | Tailwind CSS v4 + design system proprio em `globals.css` | Consistencia visual sem inventar valores por tela |
| Banco | SQLite (`better-sqlite3`) em `/data` | Exigencia do desafio; sincrono e sem servidor, ideal para um app de portal |
| Validacao | Zod | Erros de formulario campo a campo, em portugues |
| Integracao | API REST oficial do Bitrix24 | Exigencia: sem API nem token do Vibecode |

## Estrutura

```
src/
  app/
    api/
      bitrix/oauth/callback/  troca do code por tokens (OAuth)
      bitrix/events/          ONAPPINSTALL / ONAPPUNINSTALL
      setup/status/           estado da configuracao (wizard)
      setup/webhook/          conectar por webhook de entrada
      setup/oauth/            iniciar fluxo OAuth
      diagnostico/            saude da integracao + ultimos logs
      health/                 healthcheck para a Onnira
    setup/                    wizard de configuracao inicial
    (app)/                    telas do aplicativo
  components/ui/              design system (Button, Input, Stepper, Toast...)
  lib/
    bitrix/client.ts          cliente REST: OAuth + webhook, refresh, batch
    bitrix/discovery.ts       descoberta de funis/etapas/campos em runtime
    bitrix/permissions.ts     escopos e permissoes do usuario
    db/index.ts               conexao SQLite + migracoes
    db/portals.ts             portais, tokens e credenciais (cifrados)
    db/cache.ts               cache local com TTL e stale-on-error
    crypto.ts                 AES-256-GCM para segredos em repouso
    env.ts                    variaveis de ambiente validadas
    errors.ts                 erros com mensagem pronta para o usuario
    logger.ts                 log estruturado, com redacao de segredos
    setup.ts                  regras do wizard (os dois modos de conexao)
scripts/
  onnira-deploy.mjs           publica/atualiza o app na Onnira Cloud AI
  br24-vault                  CLI do vault de conhecimento do projeto
data/                         banco SQLite (conteudo fora do git)
```

## Rodando localmente

```bash
npm install
cp .env.example .env.local

# gere a chave de cifragem dos segredos e cole em APP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

npm run dev
```

Abra http://localhost:3000 — sem configuracao, o app leva direto ao wizard.

## Como o cliente conecta o portal

O ponto de entrada do produto e a **Onnira Cloud AI**: o cliente instala o app
la e, de dentro dele, conecta o proprio portal Bitrix24. O app nao roda
embarcado em iframe do Bitrix, entao nao depende de placements.

O wizard oferece dois modos, com divulgacao progressiva:

**1. Webhook de entrada — recomendado (cerca de 1 minuto)**
No Bitrix24: *Aplicativos > Webhooks > Webhook de entrada*. Marque os escopos
necessarios, copie a URL gerada e cole no wizard. Nao expira.
E o caminho que o guia do desafio descreve ("um assistente para o cliente
informar tokens e parametros"), e o que um cliente conclui sozinho.

> **Ressalva honesta, exibida na propria interface:** um webhook e vinculado ao
> usuario que o criou, e toda chamada REST roda com os direitos dele. Nesse
> modo o app nao distingue quem esta usando. Por isso o wizard orienta a marcar
> somente os escopos necessarios e mostra de quem e o webhook.

**2. Aplicativo local / OAuth — avancado (cerca de 5 minutos)**
No Bitrix24: *Aplicativos > Desenvolvedores > Outro > Aplicativo local*.
Cadastre como URL de redirecionamento o valor que o wizard mostra
(`<URL do app>/api/bitrix/oauth/callback`), copie o ID e a chave secreta para o
wizard e autorize.
Beneficios que justificam os passos extras: **respeita a permissao de cada
usuario**, identifica quem executou cada acao, autorizacao revogavel pelo
portal e habilita uso embarcado dentro do Bitrix24.

Em ambos os casos o app so marca a configuracao como concluida **depois de uma
chamada REST real bem-sucedida** contra o portal.

## Seguranca e dados

- Nenhum token, chave ou senha no codigo-fonte: tudo em variavel de ambiente
  ou informado pelo cliente no wizard.
- Tokens OAuth, `client_secret` e a URL do webhook ficam **cifrados** no SQLite
  com AES-256-GCM (`APP_ENCRYPTION_KEY`).
- Os logs passam por redacao automatica: campos como `access_token`,
  `refresh_token` e `client_secret` nunca sao gravados.
- Somente os escopos necessarios sao solicitados, e o app respeita as
  permissoes do usuario no Bitrix24 (`user.admin`, `scope`), escondendo o que
  ele nao pode fazer em vez de deixar a acao falhar.
- `ONAPPUNINSTALL` apaga os dados daquele portal (cascata no banco).
- Multi-cliente por construcao: nada e chaveado por ID fixo de portal,
  usuario, campo ou funil — tudo e descoberto em tempo de execucao.
- Nos testes e na apresentacao, apenas dados ficticios.

## Cache local

Nenhuma tela chama a API do Bitrix diretamente: tudo passa por
`lib/db/cache.ts`, com TTL por natureza do dado (metadados 1h, cadastros
15min, operacional 2min). Quando o cache esta vencido e o portal falha, o app
serve o valor anterior marcado como desatualizado — a tela nunca fica em branco
por instabilidade do portal.

## Publicando na Onnira Cloud AI

```bash
export ONNIRA_API_KEY=onnira_sk_...          # nunca comitar

node scripts/onnira-deploy.mjs me            # confere a chave e a licenca
node scripts/onnira-deploy.mjs criar         # primeiro deploy
node scripts/onnira-deploy.mjs status <ID>   # DEPLOYING | RUNNING | FAILED
node scripts/onnira-deploy.mjs logs <ID>
node scripts/onnira-deploy.mjs atualizar <ID>
```

O ZIP enviado exclui `node_modules`, `.next`, `.git`, `data/` e qualquer
`.env` — nenhum segredo ou dado de cliente sai da maquina.

Depois do deploy, defina no painel da Onnira: `APP_ENCRYPTION_KEY` e
`APP_BASE_URL` (a URL publica do app).

## Prazos do desafio

| Data | Entrega |
|---|---|
| 21/10, 16h | Sorteio do tema |
| 21 a 29/10 | Desenvolvimento |
| 22/10 e 27/10 | Plantoes de duvidas |
| 29/10 | Pitch de 5 minutos (app funcionando) |
| 03/11 | Entrega definitiva + materiais de publicacao |
| 06/11 | Resultado |
