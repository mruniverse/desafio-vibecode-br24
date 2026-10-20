# Vault Obsidian — o RAG do time

Este projeto tem um **vault Obsidian com Protocolo RAG**. Não é documentação opcional: é o
mecanismo que faz a dupla (e as IAs) não redescobrirem a mesma armadilha do Bitrix24 três vezes
num desafio de 8 dias.

- **Vault:** `~/Documents/Obsidian Vault/Br24 Vibecode`
- **CLI:** `./scripts/br24-vault` (variável de ambiente `BR24_VAULT` sobrescreve o caminho)
- **Contrato completo:** `99-meta/Protocolo RAG.md` dentro do vault — ele vence em caso de
  divergência com este resumo.

## O contrato, em duas fases

**RECALL — antes de qualquer trabalho não-trivial.** Orçamento: no máximo 8 notas.

```bash
./scripts/br24-vault tree BR24-001          # pai, irmãs, filhas
./scripts/br24-vault search "oauth token"   # no máximo 4 notas de 20-conhecimento/
```

Depois registre o que leu numa seção `## Contexto recuperado` da nota que você vai escrever, um
wikilink por nota consultada e uma linha dizendo o que ela mudou na sua decisão. **Recall vazio é
resultado válido** — escreva "nada relevante no vault" explicitamente.

**Leitura obrigatória de quem toca na integração:** a nota
`20-conhecimento/dominios/bitrix24-rest-oauth-integracao.md`. Os invariantes dela (zero id de
portal/campo/funil hardcoded, token fora do código-fonte, respeitar a permissão do usuário no
Bitrix, re-bind de `placement` por portal, cache contra o timeout de ~30s do painel de CRM) são
critério de avaliação do desafio, não preferência de estilo.

**CAPTURE — ao terminar.** Escreva só a nota que lhe pertence, frontmatter com `atualizado` de
hoje, wikilinks para pai/irmãs/domínios. **Toda descoberta reutilizável além da tarefa vira nota
em `20-conhecimento/`** — é essa regra, e só ela, que enche o RAG. Feche com:

```bash
./scripts/br24-vault index
./scripts/br24-vault check     # tem que terminar em "zero erro"
```

## Comandos

```bash
./scripts/br24-vault search <termos> [--tipo T] [--repo R] [--tag G] [--limit N]
./scripts/br24-vault tree [<TASK-ID>]
./scripts/br24-vault path <TASK-ID>
./scripts/br24-vault new task BR24-NNN [--pai ID] [--titulo T] [--repos a,b] [--status S]
./scripts/br24-vault new note <TASK-ID> <plano|execucao|handoff|review-plano|review-codigo|po|pr|narrativa>
./scripts/br24-vault new knowledge <repos|dominios|incidentes|decisoes> <slug> [--titulo T] [--tags t1,t2]
./scripts/br24-vault link <A> <B>
./scripts/br24-vault index
./scripts/br24-vault check
```

**Use sempre o CLI** para criar nota e resolver caminho. Ele aplica schema e nomenclatura por
código; caminho montado à mão quebra `[[wikilink]]`, que o Obsidian resolve por nome de arquivo.

## IDs de tarefa

Sem tracker externo. Id **local e sequencial**: `BR24-001`, `BR24-002`, … sempre três dígitos. O
`check` recusa pasta fora do formato e o `new task` sugere o próximo livre. Tarefa filha nasce
dentro da pasta do pai.

## Estrutura

```
Br24 Vibecode/
├── README.md             # porta de entrada (um só README no vault inteiro)
├── 00-indices/           # GERADO por `br24-vault index` — não editar à mão
├── 10-tarefas/           # BR24-NNN/, filha dentro da pasta do pai
├── 20-conhecimento/      # repos/ dominios/ incidentes/ decisoes/
├── 30-infra/             # hospedagem, ambientes, cronograma
└── 99-meta/              # Protocolo RAG, Schema de frontmatter, templates/
```

## O que o vault NÃO guarda

Se a informação **descreve o código**, ela vive no código. O vault guarda o que o código não
guarda: por que se decidiu, o que já falhou, o que uma armadilha custou, o estado de uma tarefa.
Duas verdades sobre a mesma coisa divergem em dias.

E nunca, em nota nenhuma: `.env`, `client_secret`, `access_token`, chave `onnira_sk_...` ou
qualquer credencial. Nomes de chave, nunca valores.

## Conhecimento já semeado

| Nota | Para quê |
|---|---|
| `dominios/bitrix24-rest-oauth-integracao` | OAuth, app instalável, os invariantes e as armadilhas da API |
| `dominios/onnira-cloud-ai-api` | API de deploy: descoberta por `GET /me`, `runtime: next`, `/data` persistente, 5 req/s |
| `decisoes/ADR-0001-stack-e-arquitetura-do-app` | a stack, as alternativas rejeitadas e o vínculo com os critérios de avaliação |
| `repos/desafio-vibecode-br24` | pontos de entrada e armadilhas deste repo |
| `30-infra/cronograma-e-entregaveis` | datas (sorteio 21/10, pitch 29/10, entrega 03/11) e pesos da avaliação |
| `10-tarefas/BR24-001` | nota-hub da tarefa em andamento (preparação pré-sorteio) |
