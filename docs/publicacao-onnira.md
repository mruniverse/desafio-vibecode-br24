# Revezza — publicação e operação na Onnira Cloud AI

> Estado em 27/10/2026: guia de preparação. O deploy completo, a persistência do SQLite,
> a identidade individual no Bitrix e a publicação em catálogo ainda precisam ser validados.
> O modo de demonstração usa identidades fictícias e não é adequado a dados reais.
>
> A API autenticada respondeu HTTP 200 em `/me` e `/cloud/apps`. A existência de disco
> por aplicação não comprova que seus arquivos sobrevivam a reinício ou novo deploy.
> O runtime `next` informado pela API usa porta 3000 e aceita diretório base `/`.

## Antes de publicar

1. Revise e teste a versão destinada à publicação. O GitHub público usa a branch escolhida no formulário;
   alterações locais não aparecem na Onnira até serem enviadas para essa branch.
2. Confira que o repositório e a branch estão acessíveis publicamente. Não torne um repositório público
   sem revisar seu histórico e obter autorização.
3. Não inclua credenciais, URLs de webhook, arquivos `.env`, bancos SQLite ou dados pessoais no GitHub.
4. Para a primeira demonstração use apenas dados fictícios. Não ative escrita no Bitrix real até que
   exista um portal de teste, o controle de segurança seja corrigido e o fluxo tenha sido validado.
5. Confirme previamente na Onnira como configurar variáveis de ambiente, disponibilidade de Node.js
   compatível com as dependências nativas e armazenamento persistente para o banco SQLite.

## Cadastro pelo GitHub público

Na tela **Suas aplicações → Adicionar aplicação**:

1. Selecione **GitHub → Usar repositório público**. Na tela observada, a conexão de GitHub privado
   aparece como “em breve”; não presumir que aceite repositórios privados.
2. Informe a URL pública do repositório. Neste projeto:
   `https://github.com/mruniverse/desafio-vibecode-br24`.
3. Informe a branch que contém a versão revisada. `main` é a branch padrão do repositório; antes do
   deploy confirme que o commit desejado já está nela. Não presumir que alterações locais foram enviadas.
4. Escolha Next.js se a opção estiver disponível; caso use **Outro / configurar manualmente**, preencha:
   - Diretório base: raiz do repositório (`/` no script de API do projeto; no formulário, use vazio se
     a interface interpretar vazio como raiz; confirme a convenção da tela).
   - Comando de instalação: `npm ci`
   - Comando de build: `npm run build`
   - Comando para iniciar: `npm start`
   - Porta: `3000`
5. Antes de clicar em **Criar e publicar**, confira custo, visibilidade, como informar variáveis e
   onde os dados serão armazenados. A ação cria uma aplicação e pode iniciar consumo de recursos.
6. Configure as variáveis necessárias no mecanismo de segredos da Onnira. Nunca cole valores no README,
   nos campos de comando ou no GitHub. Se a plataforma só permitir configurá-las após criar a aplicação,
   confirme como refazer o build/deploy antes de depender do resultado.
7. Acompanhe o build e os logs pelo painel. Depois abra a URL HTTPS e valide a aplicação, não apenas o
   status do processo. A URL da aplicação é o acesso ao app hospedado; isso não demonstra, por si só,
   inclusão em um catálogo/Marketplace.

### Alternativa ZIP/API

O formulário também oferece ZIP. O projeto inclui `scripts/onnira-deploy.mjs`; o comando `listar` é
somente leitura e `criar` cria uma aplicação. Antes de usar ZIP, inspecione o conteúdo e confirme que
não há segredos, bancos, evidências de portal ou arquivos locais. Sem especificação de custo e
persistência confirmada, não execute criação automaticamente.

## Variáveis de ambiente

| Nome | Finalidade | Orientação |
|---|---|---|
| `APP_ENCRYPTION_KEY` | Chave mestra para cifrar credenciais em repouso. | Gere 32 bytes aleatórios em base64; mantenha em gerenciador de segredos e faça backup seguro. Não troque entre deploys: dados cifrados com a chave antiga podem ficar inacessíveis. |
| `APP_BASE_URL` | URL pública do app, usada no fluxo OAuth. | Configure com a URL HTTPS atribuída após o deploy e valide a atualização. |
| `DATABASE_PATH` | Caminho do arquivo SQLite. | Use somente um caminho que a Onnira confirme ser persistente e gravável; o padrão do app é `./data/app.db`, mas sua persistência na plataforma não foi confirmada. |
| `MODO_DEMO` | Habilita seleção de pessoas fictícias sem identidade verificada. | Padrão `0`; use `1` exclusivamente para demonstração sem dados reais. O selo deve permanecer visível. |
| `BITRIX_ESCRITA` | Autoriza chamadas de escrita no calendário Bitrix. | Mantenha `0`. O código exige `BITRIX_ESCRITA=1` e confirmação explícita de portal de teste, mas isso nunca foi validado contra um portal real. |
| `SYNC_SECRET` | Variável reservada para eventual mecanismo de reprocessamento. | Ainda não protege a rota atual: o reprocessamento usa sessão. Não anunciar proteção por segredo até implementá-la e testá-la. |
| `BITRIX_CLIENT_ID`, `BITRIX_CLIENT_SECRET` | Credenciais OAuth opcionais. | Não exigidas para demo simulada; fluxo real de identidade ainda requer validação. |

Gerar a chave mestra localmente, sem colocá-la no histórico de comandos ou no repositório:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copie o resultado diretamente ao gerenciador de segredos da Onnira e guarde uma cópia segura. Não
publique a saída desse comando. A variável `ONNIRA_API_KEY` é usada pelo script local de publicação;
não é necessária como variável do aplicativo apenas para executar o Revezza.

## Como o produto deve funcionar no ambiente hospedado

1. A Onnira constrói e executa o app Next.js e fornece uma URL HTTPS.
2. O usuário abre essa URL e configura o app; a integração Bitrix é feita pelo servidor, não pelo navegador.
3. No fluxo proposto, o app mantém pedidos, aprovações e saldos; o Bitrix recebe o espelho de ausência.
   A sincronização no sentido inverso foi discutida e ainda precisa de contrato e validação.
4. A demonstração grava em SQLite (`DATABASE_PATH`) com dados fictícios e sobrevive a reinício do processo
   **se o diretório do banco for persistente** (testado localmente; na Onnira ainda não confirmado). Um
   novo deploy pode substituir o disco: não prometa persistência até testar reinício e redeploy lá.
   A sincronização com o Bitrix é simulada (`BITRIX_ESCRITA=0`).
5. `MODO_DEMO=1` permite escolher uma pessoa sem validar sua identidade. Não use esse modo com dados
   reais, nem anuncie que o usuário Bitrix foi autenticado individualmente.
6. O webhook opera com as permissões de quem o criou; ele não identifica individualmente os usuários
   do aplicativo. Nunca apresente o webhook como controle de acesso individual.

## Checklist antes de compartilhar a URL

- [ ] Branch e commit publicados correspondem à versão revisada.
- [ ] Build e aplicação iniciam com as variáveis corretas; URL HTTPS responde.
- [ ] Solicitação → aprovação → calendário funciona e qualquer integração simulada é identificada.
- [ ] Credenciais e motivos privados não aparecem na interface, nos arquivos servidos nem nos logs.
- [ ] Após reinício e novo deploy, a persistência prometida foi testada. Se não houver volume persistente,
      não usar SQLite para dados que precisam sobreviver ao ciclo de vida da aplicação.
- [ ] Permissões, identidade, plano Bitrix, escopos e integração real foram comprovados antes de dados reais.
- [ ] Política de pausa/rollback e custo de hospedagem conhecidos.
- [ ] Requisitos do Banco de Aplicações/Marketplace confirmados separadamente com a organização.


## Comportamento a conhecer antes de demonstrar

- **Aprovar consulta o calendário do Bitrix na hora**, sem cache e sem alternativa. Se a consulta falhar, a aprovação devolve 503 ("Não conseguimos confirmar o calendário de trabalho agora") e o pedido continua pendente. Em modo demo isso não ocorre, pois o Bitrix é simulado.
- **Se o calendário mudou desde o pedido** (feriado novo, por exemplo), a aprovação pede confirmação mostrando os dias contados agora; o botão vira "Confirmar e aprovar".
- Todo evento de ausência vai ao Bitrix como **dia inteiro** (decisão da reunião de 27/10).
- O Bitrix só aponta conflito para eventos de calendário, não para tarefas.
