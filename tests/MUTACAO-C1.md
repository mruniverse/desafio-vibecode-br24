# Mutação manual — C1 (BR24-005)

Cada mutante altera **uma** expressão do domínio, roda `npm run test:dominio` e é revertido em seguida (hash do arquivo conferido igual ao original após cada rodada). Resultado: **30/30 mutantes mortos**, nenhum sobrevivente. O M23 sobreviveu na primeira rodada; o teste `janela: no limite exato (5 de 5 trabalhando)...` foi adicionado e agora o mata.

Linha de base: `npm run test:dominio` verde (62 testes).

| # | Arquivo (`src/lib/ausencias/`) | Mutante | Teste(s) que falharam (2 primeiros de N) |
|---|---|---|---|
| M01 | datas.ts | validarIntervalo: fim < inicio vira <= | `datas: intervaloInclusivo, diasEntre e limites`; `dias uteis: feriado em fim de ano nao conta e contagem e inclusiva` (+18) |
| M02 | datas.ts | ehDataISO: dia <= ultimo dia do mes vira < | `datas: ehDataISO cobre ano bissexto, mes/dia invalido e anos < 100`; `datas: somarDias, meses, anos, negativos e limites` (+25) |
| M03 | datas.ts | ehBissexto: some a regra de 400 anos | `datas: ehDataISO cobre ano bissexto, mes/dia invalido e anos < 100`; `dias uteis: feriado fixo, feriado do ano, excecao trabalhada e folga semanal` |
| M04 | datas.ts | exigirInteiro: aceita nao inteiro/Infinity (so rejeita NaN) | `datas: somarDias, meses, anos, negativos e limites`; `contrato: toda funcao exportada tem caso invalido (lanca o subcodigo; predicados devolvem false)` (+1) |
| M05 | datas.ts | intervaloInclusivo: limite > 366 vira >= 366 | `datas: intervaloInclusivo, diasEntre e limites` |
| M06 | datas.ts | paraDate: Date.UTC-like (perde ano < 100): usa setUTCFullYear com ano + 1900 para ano < 100 | `datas: ehDataISO cobre ano bissexto, mes/dia invalido e anos < 100`; `datas: somarDias, meses, anos, negativos e limites` |
| M07 | estados.ts | aprovar: remove a regra aprovador != solicitante | `estados: aprovar muda status, registra decisor e nao aprova o proprio pedido` |
| M08 | estados.ts | cancelar: colaborador cancela ate o dia do inicio (hoje < inicio vira <=) | `estados: cancelar - quem pode e para qual sincronizacao vai` |
| M09 | estados.ts | recusar: motivo minimo 10 vira 9 | `estados: recusar exige motivo de 10+ caracteres, aceita sugestao valida` |
| M10 | estados.ts | matriz: permite aprovada/ok -> aprovada/em_andamento | `estados: TODOS os 1024 pares origem->destino; invalidos lancam e deixam o estado intacto`; `estados: sincronizacao fora de ordem lanca` |
| M11 | estados.ts | falharSincronizacao: escala na 3a falha vira na 4a (>= vira >) | `estados: ciclo de sincronizacao - 3 tentativas, depois falha_manual (admin retoma)`; `estados: remocao no Bitrix (cancelada) segue remocao_pendente -> em_andamento -> removido\|falha` |
| M12 | estados.ts | intervaloVigente: cancelada ate canceladoEm (nao canceladoEm-1) | `saldo: cancelamento usa canceladoEm (estorna so dias uteis >= canceladoEm)`; `estados: intervaloVigente (pendente/aprovada inteiro; cancelada ate canceladoEm-1; recusada nunca)` (+1) |
| M13 | saldo.ts | FIFO: ordem de vencimento invertida | `saldo: fronteira venceEm = dia de uso (usa o lote); dia seguinte nao usa`; `saldo: FIFO consome o credito que vence primeiro; sem vencimento por ultimo` |
| M14 | saldo.ts | FIFO: venceEm = dia de uso deixa de servir (>= vira >) | `saldo: fronteira venceEm = dia de uso (usa o lote); dia seguinte nao usa` |
| M15 | saldo.ts | fronteira venceEm = hoje: credito do dia ja nao conta (>= vira >) | `saldo: fronteira venceEm = hoje conta; no dia seguinte vence`; `indicadores: ferias vencendo (fronteira de 90 dias, vencido e FIFO)` |
| M16 | saldo.ts | debito ignora o ano de competencia do credito | `saldo: pedido que cruza dez/jan divide o debito por ano e nao toca o ano errado` |
| M17 | saldo.ts | vencendo: horizonte 90 vira 91 dias | `indicadores: ferias vencendo (fronteira de 90 dias, vencido e FIFO)` |
| M18 | saldo.ts | pendente deixa de reservar saldo (so aprovada debita) | `saldo: pendente reserva, recusada nao debita, outra pessoa e outra carteira nao interferem`; `saldo: simularPedido calcula antes/depois, excedente e tipo sem saldo` |
| M19 | cobertura.ts | abaixo do minimo: < vira <= | `cobertura: no limite (5 de 5) nao esta abaixo; 1 a menos esta`; `cobertura: contarPendentes liga/desliga o peso dos pedidos pendentes` (+2) |
| M20 | cobertura.ts | contarPendentes ignorado (pendente sempre conta) | `cobertura: contarPendentes liga/desliga o peso dos pedidos pendentes`; `indicadores: dias por tipo nos proximos 90 dias (dias uteis, pendente e cancelada nao entram)` (+1) |
| M21 | cobertura.ts | dia nao util tambem pode ficar abaixo do minimo | `cobertura: so dias uteis - fim de semana e feriado nunca ficam abaixo do minimo` |
| M22 | cobertura.ts | gestor fora da equipe (membros ignoram quem e gestor) | `cobertura: 7 pessoas, minimo 5, 3 ausencias num dia = 1 dia abaixo do minimo`; `cobertura: no limite (5 de 5) nao esta abaixo; 1 a menos esta` (+12) |
| M23 | janela.ts | melhorJanela: minimo respeitado vira estrito (< vira <=) | `janela: no limite exato (5 de 5 trabalhando) a janela serve; com 4 nao` |
| M24 | janela.ts | melhorJanela: ordem por menor minimo primeiro | `janela: ate 3 janelas ordenadas por maior minimo e depois inicio`; `janela: respeita o minimo em todos os dias e nao propoe dias abaixo dele` (+1) |
| M25 | janela.ts | melhorJanela: comeca hoje em vez de amanha | `janela: no limite exato (5 de 5 trabalhando) a janela serve; com 4 nao`; `janela: janelas comecam amanha, cabem em 180 dias e nao existem se n nao cabe` |
| M26 | indicadores.ts | supressao n < 3 vira n < 2 | `indicadores: tipos sensiveis agregam como 'Ausências' e somem com menos de 3 pessoas` |
| M27 | indicadores.ts | atrasado: prazo < agora vira <= | `indicadores: por status, aguardando/atrasados (fronteira do prazo), taxa e tempo medio` |
| M28 | indicadores.ts | horizonte do painel 90 vira 89 dias | `indicadores: horizonte de 90 dias e inclusivo (hoje..hoje+90)` |
| M29 | dias-uteis.ts | excecao trabalhada deixa de vencer o fim de semana | `dias uteis: feriado fixo, feriado do ano, excecao trabalhada e folga semanal` |
| M30 | dias-uteis.ts | calendarioDoPortal(null) sem sabado/domingo | `dias uteis: calendarioDoPortal(null) = sabado e domingo, sem feriado` |

## Comando de cada mutante

Rodar da raiz do worktree. Cada linha aplica o mutante com `perl`, executa o teste (esperado: falha) e restaura o arquivo a partir de `$TMPDIR/mut.bak`.

```bash
# M01 — validarIntervalo: fim < inicio vira <=
f=src/lib/ausencias/datas.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qif (f < i) throw new ErroDominio("INTERVALO_INVALIDO"\E#if (f <= i) throw new ErroDominio("INTERVALO_INVALIDO"#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M02 — ehDataISO: dia <= ultimo dia do mes vira <
f=src/lib/ausencias/datas.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qdia >= 1 && dia <= diasNoMes(ano, mes)\E#dia >= 1 && dia < diasNoMes(ano, mes)#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M03 — ehBissexto: some a regra de 400 anos
f=src/lib/ausencias/datas.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Q(ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0\E#(ano % 4 === 0 && ano % 100 !== 0)#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M04 — exigirInteiro: aceita nao inteiro/Infinity (so rejeita NaN)
f=src/lib/ausencias/datas.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qtypeof valor !== "number" || !Number.isInteger(valor)\E#typeof valor !== "number" || Number.isNaN(valor)#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M05 — intervaloInclusivo: limite > 366 vira >= 366
f=src/lib/ausencias/datas.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qif (total > MAX_DIAS_INTERVALO)\E#if (total >= MAX_DIAS_INTERVALO)#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M06 — paraDate: Date.UTC-like (perde ano < 100): usa setUTCFullYear com ano + 1900 para ano < 100
f=src/lib/ausencias/datas.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qd.setUTCFullYear(Number(valida.slice(0, 4)), Number(valida.slice(5, 7)) - 1, Number(valida.slice(8, 10)));\E#d.setUTCFullYear(Number(valida.slice(0, 4)) < 100 ? Number(valida.slice(0, 4)) + 1900 : Number(valida.slice(0, 4)), Number(valida.slice(5, 7)) - 1, Number(valida.slice(8, 10)));#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M07 — aprovar: remove a regra aprovador != solicitante
f=src/lib/ausencias/estados.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qif (ator === p.pessoaId) throw new ErroDominio("SEM_PERMISSAO", "ninguem aprova o proprio pedido");\E#if (ator === p.pessoaId && ator === "") throw new ErroDominio("SEM_PERMISSAO", "ninguem aprova o proprio pedido");#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M08 — cancelar: colaborador cancela ate o dia do inicio (hoje < inicio vira <=)
f=src/lib/ausencias/estados.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Q!(dia < p.inicio)\E#!(dia <= p.inicio)#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M09 — recusar: motivo minimo 10 vira 9
f=src/lib/ausencias/estados.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qexport const MIN_CARACTERES_MOTIVO = 10;\E#export const MIN_CARACTERES_MOTIVO = 9;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M10 — matriz: permite aprovada/ok -> aprovada/em_andamento
f=src/lib/ausencias/estados.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Q"aprovada/ok": ["cancelada/remocao_pendente"],\E#"aprovada/ok": ["cancelada/remocao_pendente", "aprovada/em_andamento"],#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M11 — falharSincronizacao: escala na 3a falha vira na 4a (>= vira >)
f=src/lib/ausencias/estados.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qfeitas >= MAX_TENTATIVAS_SYNC ? "falha_manual" : "falha"\E#feitas > MAX_TENTATIVAS_SYNC ? "falha_manual" : "falha"#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M12 — intervaloVigente: cancelada ate canceladoEm (nao canceladoEm-1)
f=src/lib/ausencias/estados.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\QsomarDias(validarData(p.canceladoEm, "canceladoEm"), -1)\E#somarDias(validarData(p.canceladoEm, "canceladoEm"), 0)#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M13 — FIFO: ordem de vencimento invertida
f=src/lib/ausencias/saldo.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qreturn a.venceEm < b.venceEm ? -1 : 1;\E#return a.venceEm < b.venceEm ? 1 : -1;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M14 — FIFO: venceEm = dia de uso deixa de servir (>= vira >)
f=src/lib/ausencias/saldo.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Ql.restante > 0 && (l.venceEm === null || l.venceEm >= d.data)\E#l.restante > 0 && (l.venceEm === null || l.venceEm > d.data)#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M15 — fronteira venceEm = hoje: credito do dia ja nao conta (>= vira >)
f=src/lib/ausencias/saldo.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qconst vale = (l: Lote) => l.venceEm === null || l.venceEm >= hoje;\E#const vale = (l: Lote) => l.venceEm === null || l.venceEm > hoje;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M16 — debito ignora o ano de competencia do credito
f=src/lib/ausencias/saldo.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Ql.ano === d.ano && l.restante > 0\E#l.restante > 0#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M17 — vencendo: horizonte 90 vira 91 dias
f=src/lib/ausencias/saldo.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qexport const HORIZONTE_VENCIMENTO_DIAS = 90;\E#export const HORIZONTE_VENCIMENTO_DIAS = 91;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M18 — pendente deixa de reservar saldo (so aprovada debita)
f=src/lib/ausencias/saldo.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qconst vigente = intervaloVigente(p);\E#const vigente = p.status === "pendente" ? null : intervaloVigente(p);#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M19 — abaixo do minimo: < vira <=
f=src/lib/ausencias/cobertura.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\QabaixoDoMinimo: util && trabalhando < entrada.equipe.minimoPessoas\E#abaixoDoMinimo: util && trabalhando <= entrada.equipe.minimoPessoas#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M20 — contarPendentes ignorado (pendente sempre conta)
f=src/lib/ausencias/cobertura.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qif (p.status === "pendente" && !contarPendentes) return null;\E#if (p.status === "pendente" && !contarPendentes && false) return null;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M21 — dia nao util tambem pode ficar abaixo do minimo
f=src/lib/ausencias/cobertura.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\QabaixoDoMinimo: util && trabalhando\E#abaixoDoMinimo: trabalhando#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M22 — gestor fora da equipe (membros ignoram quem e gestor)
f=src/lib/ausencias/cobertura.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qreturn pessoas.filter((p) => p.equipeId === equipe.id);\E#return pessoas.filter((p) => p.equipeId === equipe.id && p.id !== equipe.gestorId);#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M23 — melhorJanela: minimo respeitado vira estrito (< vira <=)
f=src/lib/ausencias/janela.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qif (minimo < entrada.equipe.minimoPessoas) continue;\E#if (minimo <= entrada.equipe.minimoPessoas) continue;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M24 — melhorJanela: ordem por menor minimo primeiro
f=src/lib/ausencias/janela.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qb.minTrabalhando - a.minTrabalhando ||\E#a.minTrabalhando - b.minTrabalhando ||#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M25 — melhorJanela: comeca hoje em vez de amanha
f=src/lib/ausencias/janela.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qde: somarDias(hoje, 1),\E#de: hoje,#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M26 — supressao n < 3 vira n < 2
f=src/lib/ausencias/indicadores.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qexport const SUPRESSAO_MINIMA = 3;\E#export const SUPRESSAO_MINIMA = 2;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M27 — atrasado: prazo < agora vira <=
f=src/lib/ausencias/indicadores.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\QcompararInstantes(p.prazoEm, agora) < 0\E#compararInstantes(p.prazoEm, agora) <= 0#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M28 — horizonte do painel 90 vira 89 dias
f=src/lib/ausencias/indicadores.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qexport const HORIZONTE_PAINEL_DIAS = 90;\E#export const HORIZONTE_PAINEL_DIAS = 89;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M29 — excecao trabalhada deixa de vencer o fim de semana
f=src/lib/ausencias/dias-uteis.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qif (cal.excecoesTrabalhadas.has(d)) return true;\E#if (cal.excecoesTrabalhadas.has(d) && false) return true;#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
# M30 — calendarioDoPortal(null) sem sabado/domingo
f=src/lib/ausencias/dias-uteis.ts; cp $f "$TMPDIR/mut.bak" && perl -0pi -e 's#\Qconst PADRAO_NAO_UTEIS = ["SA", "SU"];\E#const PADRAO_NAO_UTEIS = ["SU"];#' $f && npm run test:dominio --silent; cp "$TMPDIR/mut.bak" $f
```

Depois de qualquer rodada manual, confirme `npm run test:dominio` verde (arquivos revertidos).
