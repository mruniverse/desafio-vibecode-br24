# Aplicativo Br24 — Desafio Vibecode

Aplicativo de Gestão de Férias e Ausências para o Desafio Vibecode Br24 (Atomic Group),
com integração ao **Bitrix24** e hospedagem na **Onnira Cloud AI** planejadas e ainda
não comprovadas em ambiente real.

**Dupla:** Yuri Luz e Tiago Duarte
**Nosso diferencial:** facilidade de uso — interface intuitiva, em portugues,
responsiva, com configuracao guiada que qualquer cliente conclui sozinho.

> Tema: Gestão de Férias e Ausências. O aplicativo está em desenvolvimento;
> a demonstração atual usa dados fictícios e integração Bitrix simulada.
> Persistência, identidade individual e publicação precisam ser verificadas antes do uso real.

---

## Stack

| Camada | Escolha | Por que |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript strict | Exigencia do desafio (Next.js/Node.js); App Router renderiza no servidor e nunca expoe token ao navegador |
| Estilo | Tailwind CSS v4 + design system proprio em `globals.css` | Consistencia visual sem inventar valores por tela |
| Banco | SQLite (`better-sqlite3`), padrão `./data/app.db` | A persistência do diretório na Onnira ainda precisa ser confirmada |
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

O ponto de entrada planejado do produto é a **Onnira Cloud AI**: o cliente
acessaria o app hospedado e conectaria o próprio portal Bitrix24. O mecanismo de
publicação em catálogo ainda não foi confirmado; não presumimos instalação por lá.
O app não depende de placements nem de iframe no Bitrix.

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
O fluxo OAuth da base técnica precisa ser validado para este produto. Não se deve
presumir que ele já autentique individualmente cada usuário, aplique suas
permissões ou habilite uso embarcado no Bitrix24.

Em ambos os casos o app so marca a configuracao como concluida **depois de uma
chamada REST real bem-sucedida** contra o portal.

## Seguranca e dados

- Nenhum token, chave ou senha no codigo-fonte: tudo em variavel de ambiente
  ou informado pelo cliente no wizard.
- Tokens OAuth, `client_secret` e a URL do webhook ficam **cifrados** no SQLite
  com AES-256-GCM (`APP_ENCRYPTION_KEY`).
- Os logs passam por redacao automatica: campos como `access_token`,
  `refresh_token` e `client_secret` nunca sao gravados.
- Os escopos mínimos e o respeito às permissões individuais precisam ser
  verificados contra um portal de teste; o webhook usa os direitos de quem o criou.
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

Consulte o [passo a passo de publicação e operação na Onnira](docs/publicacao-onnira.md),
com os campos do formulário, variáveis, limitações atuais e checklist de segurança.
As rotas de ausências usam SQLite (dados fictícios no modo demonstração) e um Bitrix24 simulado.
Identidade real, persistência do disco na Onnira e integração com um portal Bitrix real
ainda precisam de validação antes de qualquer uso com dados reais.

```bash
export ONNIRA_API_KEY=onnira_sk_...          # nunca comitar

node scripts/onnira-deploy.mjs me            # confere a chave e a licenca
node scripts/onnira-deploy.mjs modelos       # lista modelos habilitados para sua chave
node scripts/onnira-deploy.mjs criar         # primeiro deploy
node scripts/onnira-deploy.mjs status <ID>   # DEPLOYING | RUNNING | FAILED
node scripts/onnira-deploy.mjs logs <ID>
node scripts/onnira-deploy.mjs atualizar <ID>
```

## Spike Bitrix24 (gate antes do domínio)

```bash
# somente leitura (padrão)
BITRIX_TEST_WEBHOOK="https://SEU-PORTAL.bitrix24.com.br/rest/1/CODIGO/" \
  node scripts/spike-bitrix.mjs

# opcional: cria e remove um evento de teste 'absent'
BITRIX_TEST_WEBHOOK="https://SEU-PORTAL.bitrix24.com.br/rest/1/CODIGO/" \
  node scripts/spike-bitrix.mjs --permitir-escrita
```

Saída em `spike/AAAA-MM-DD-HHmm/`:
- `evidencias.md` (tabela por endpoint, veredito, limitações, decisão)
- `resultados.json` (detalhe bruto redigido)

Regras do script:
- não imprime nem grava webhook/token;
- dados de teste apenas fictícios;
- sem `--permitir-escrita`, nenhuma mutação no portal.

O script exclui padrões como `node_modules`, `.next`, `.git`, `data/` e
`.env*`, mas isso não prova que o ZIP esteja livre de segredos. Inspecione seu
conteúdo e arquivos antes de enviar; outros nomes podem conter dados sensíveis.

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
