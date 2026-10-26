#!/usr/bin/env node
/**
 * Spike de validação da API do Bitrix24 para o app de Férias e Ausências.
 *
 * Objetivo: provar, contra um portal REAL, o que hoje é hipótese na documentação
 * (ver 20-conhecimento/dominios/ferias-e-ausencias-no-bitrix24.md, seção
 * "A confirmar contra portal real"). Produz a tabela de evidências exigida pelo
 * plano BR24-002.
 *
 * Uso:
 *   BITRIX_TEST_WEBHOOK="https://portal.bitrix24.com.br/rest/1/CODIGO/" \
 *     node scripts/spike-bitrix.mjs
 *
 *   # para incluir a criação/remoção de um evento de teste no calendário:
 *   BITRIX_TEST_WEBHOOK="..." node scripts/spike-bitrix.mjs --permitir-escrita
 *
 * REGRAS DE SEGURANÇA DESTE SCRIPT
 *  - O webhook NUNCA é impresso, gravado ou ecoado. Vem só de variável de ambiente.
 *  - Padrão é SOMENTE LEITURA. Escrita (criar/apagar evento) só com
 *    --permitir-escrita, e mesmo assim cria um evento explicitamente marcado
 *    como teste e o remove ao final.
 *  - Usa apenas dados fictícios: nomes/IDs são os que já existirem no portal de
 *    teste; nada é inventado no relatório.
 *  - Toda chamada é registrada com status, tempo e um resumo redigido.
 *
 * Saída: spike/AAAA-MM-DD-HHmm/evidencias.md + resultados.json
 */

import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ config */

const BASE = process.env.BITRIX_TEST_WEBHOOK?.trim();
const PERMITIR_ESCRITA = process.argv.includes("--permitir-escrita");
const TIMEOUT_MS = 20_000;

if (!BASE) {
  console.error(
    "Defina BITRIX_TEST_WEBHOOK com a URL de um webhook de entrada de um portal\n" +
      "de TESTE (dados fictícios). O valor não é exibido nem gravado.\n\n" +
      'Exemplo: BITRIX_TEST_WEBHOOK="https://teste.bitrix24.com.br/rest/1/CODIGO/" \\\n' +
      "  node scripts/spike-bitrix.mjs",
  );
  process.exit(1);
}

const endpoint = BASE.replace(/\/+$/, "");

/* ------------------------------------------------------- infra de chamadas */

const resultados = [];
let chamadas = 0;

/** Campos que nunca devem aparecer no relatório, em nenhum nível. */
const SENSIVEIS = new Set([
  "access_token",
  "refresh_token",
  "application_token",
  "auth",
  "authorization",
  "webhook",
  "webhook_url",
  "password",
]);

function redigir(valor, profundidade = 0) {
  if (profundidade > 6 || valor === null || valor === undefined) return valor;
  if (Array.isArray(valor)) return valor.map((v) => redigir(v, profundidade + 1));
  if (typeof valor === "object") {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) {
      saida[k] = SENSIVEIS.has(k.toLowerCase()) ? "[omitido]" : redigir(v, profundidade + 1);
    }
    return saida;
  }
  return valor;
}

/** Achata parâmetros no formato que o Bitrix espera (PHP-like). */
function achatar(obj, prefixo = "", saida = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined || v === null) continue;
    const nome = prefixo ? `${prefixo}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") achatar(item, `${nome}[${i}]`, saida);
        else saida[`${nome}[${i}]`] = String(item);
      });
    } else if (typeof v === "object") {
      achatar(v, nome, saida);
    } else {
      saida[nome] = String(v);
    }
  }
  return saida;
}

async function chamar(metodo, parametros = {}) {
  const url = `${endpoint}/${metodo}.json`;
  const inicio = Date.now();
  chamadas += 1;

  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(achatar(parametros)).toString(),
      signal: controlador.signal,
      cache: "no-store",
    });
    const texto = await resposta.text();
    const json = texto ? JSON.parse(texto) : {};
    const ms = Date.now() - inicio;

    if (json?.error) {
      return { ok: false, metodo, erro: json.error, descricao: json.error_description, status: resposta.status, ms };
    }
    return { ok: true, metodo, status: resposta.status, ms, resultado: json?.result, total: json?.total };
  } catch (erro) {
    return {
      ok: false,
      metodo,
      erro: erro.name === "AbortError" ? "TIMEOUT" : "FALHA_REDE",
      descricao: erro.message,
      ms: Date.now() - inicio,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa uma verificação do spike e acumula a evidência.
 * `avaliar` recebe a resposta e devolve { veredito, evidencia }.
 */
async function verificar({ id, titulo, pergunta, metodo, parametros, avaliar }) {
  process.stdout.write(`- ${titulo} ... `);
  const resposta = await chamar(metodo, parametros);
  const { veredito, evidencia } = avaliar(resposta);

  resultados.push({
    id,
    titulo,
    pergunta,
    metodo,
    ok: resposta.ok,
    erro: resposta.erro ?? null,
    status: resposta.status ?? null,
    ms: resposta.ms,
    veredito,
    evidencia: redigir(evidencia),
  });

  console.log(`${veredito} (${resposta.ms}ms)`);
  return resposta;
}

const amostra = (lista, n = 3) => (Array.isArray(lista) ? lista.slice(0, n) : null);

/* --------------------------------------------------------- verificações */

async function principal() {
  console.log("\nSpike Bitrix24 — Gestão de Férias e Ausências");
  console.log(`Modo: ${PERMITIR_ESCRITA ? "LEITURA E ESCRITA (evento de teste)" : "SOMENTE LEITURA"}`);
  console.log("Webhook: [omitido]\n");

  // 0) Conectividade e identidade que o webhook representa.
  const eu = await verificar({
    id: "conexao",
    titulo: "Conexão e identidade do webhook",
    pergunta: "O webhook funciona e de quem são as permissões usadas?",
    metodo: "profile",
    parametros: {},
    avaliar: (r) =>
      r.ok
        ? {
            veredito: "CONFIRMADO",
            evidencia: {
              id: r.resultado?.ID,
              nome: [r.resultado?.NAME, r.resultado?.LAST_NAME].filter(Boolean).join(" "),
              admin: r.resultado?.ADMIN,
              observacao:
                "Toda chamada deste app roda com os direitos DESTE usuario. " +
                "Sem OAuth nao ha permissao por usuario.",
            },
          }
        : { veredito: "FALHOU", evidencia: { erro: r.erro, descricao: r.descricao } },
  });

  if (!eu.ok) {
    console.log("\nSem conexão com o portal: as demais verificações não fazem sentido.");
    return finalizar();
  }

  // 1) Escopos efetivamente concedidos.
  await verificar({
    id: "escopos",
    titulo: "Escopos concedidos",
    pergunta: "O webhook tem os escopos mínimos (user_brief, department, calendar, im)?",
    metodo: "scope",
    parametros: {},
    avaliar: (r) => {
      if (!r.ok) return { veredito: "NAO_CONFIRMADO", evidencia: { erro: r.erro } };
      const escopos = Array.isArray(r.resultado) ? r.resultado : [];
      const exigidos = ["user", "user_brief", "department", "calendar", "im"];
      const presentes = exigidos.filter((e) => escopos.includes(e));
      return {
        veredito: presentes.length >= 3 ? "CONFIRMADO" : "PARCIAL",
        evidencia: { escopos, exigidosPresentes: presentes },
      };
    },
  });

  // 2) Usuários ativos e campos de RH.
  const usuarios = await verificar({
    id: "usuarios",
    titulo: "Usuários ativos e campos de RH",
    pergunta: "UF_EMPLOYMENT_DATE, WORK_POSITION e UF_DEPARTMENT vêm no user_brief?",
    metodo: "user.get",
    parametros: {
      FILTER: { ACTIVE: true, USER_TYPE: "employee" },
      select: ["ID", "NAME", "LAST_NAME", "ACTIVE", "WORK_POSITION", "UF_DEPARTMENT", "UF_EMPLOYMENT_DATE", "PERSONAL_PHOTO", "USER_TYPE"],
    },
    avaliar: (r) => {
      if (!r.ok) return { veredito: "NAO_CONFIRMADO", evidencia: { erro: r.erro } };
      const lista = r.resultado ?? [];
      const primeiro = lista[0] ?? {};
      return {
        veredito: lista.length > 0 ? "CONFIRMADO" : "PARCIAL",
        evidencia: {
          total: lista.length,
          camposRetornados: Object.keys(primeiro),
          temDataAdmissao: "UF_EMPLOYMENT_DATE" in primeiro,
          temCargo: "WORK_POSITION" in primeiro,
          departamentoEhArray: Array.isArray(primeiro.UF_DEPARTMENT),
          amostra: amostra(
            lista.map((u) => ({
              ID: u.ID,
              nome: [u.NAME, u.LAST_NAME].filter(Boolean).join(" "),
              cargo: u.WORK_POSITION,
              admissao: u.UF_EMPLOYMENT_DATE,
              departamentos: u.UF_DEPARTMENT,
            })),
          ),
        },
      };
    },
  });

  // 3) Departamentos e a hipótese central: UF_HEAD vem no retorno?
  await verificar({
    id: "departamentos",
    titulo: "Departamentos e hierarquia",
    pergunta: "department.get devolve UF_HEAD no payload? (doc lista só ID/NAME/SORT/PARENT)",
    metodo: "department.get",
    parametros: {},
    avaliar: (r) => {
      if (!r.ok) return { veredito: "NAO_CONFIRMADO", evidencia: { erro: r.erro } };
      const lista = r.resultado ?? [];
      const primeiro = lista[0] ?? {};
      const campos = Object.keys(primeiro);
      return {
        veredito: campos.includes("UF_HEAD") ? "CONFIRMADO" : "PARCIAL",
        evidencia: {
          total: lista.length,
          camposRetornados: campos,
          ufHeadNoRetorno: campos.includes("UF_HEAD"),
          conclusao: campos.includes("UF_HEAD")
            ? "UF_HEAD vem no retorno: aprovador resolvivel direto."
            : "UF_HEAD NAO vem no retorno: usar UF_HEAD como FILTRO ou subir por PARENT.",
          amostra: amostra(lista),
        },
      };
    },
  });

  // 4) UF_HEAD como filtro (funciona mesmo se nao vier no retorno).
  const primeiroUsuarioId = usuarios.ok ? usuarios.resultado?.[0]?.ID : null;
  if (primeiroUsuarioId) {
    await verificar({
      id: "ufhead-filtro",
      titulo: "UF_HEAD como filtro (fallback do aprovador)",
      pergunta: "Consigo saber de quais departamentos um usuário é chefe?",
      metodo: "department.get",
      parametros: { UF_HEAD: primeiroUsuarioId },
      avaliar: (r) => {
        if (!r.ok) return { veredito: "NAO_CONFIRMADO", evidencia: { erro: r.erro } };
        const lista = r.resultado ?? [];
        return {
          veredito: "CONFIRMADO",
          evidencia: {
            usuarioTestado: primeiroUsuarioId,
            departamentosComoChefe: lista.map((d) => ({ ID: d.ID, NAME: d.NAME })),
            observacao:
              "Filtro responde independente de UF_HEAD vir no payload. E o caminho robusto.",
          },
        };
      },
    });
  }

  // 5) Configuração de calendário: feriados e dias úteis.
  await verificar({
    id: "calendario-config",
    titulo: "Configuração de jornada e feriados",
    pergunta: "calendar.settings.get traz feriados, folgas e exceções usáveis no cálculo?",
    metodo: "calendar.settings.get",
    parametros: {},
    avaliar: (r) => {
      if (!r.ok) return { veredito: "NAO_CONFIRMADO", evidencia: { erro: r.erro } };
      const c = r.resultado ?? {};
      return {
        veredito: c.year_holidays !== undefined ? "CONFIRMADO" : "PARCIAL",
        evidencia: {
          year_holidays: c.year_holidays ?? null,
          year_workdays: c.year_workdays ?? null,
          week_holidays: c.week_holidays ?? null,
          work_time_start: c.work_time_start ?? null,
          work_time_end: c.work_time_end ?? null,
          week_start: c.week_start ?? null,
          atencao:
            "year_holidays nao tem ano (recorrente) e nao inclui feriado movel (Carnaval/Pascoa).",
        },
      };
    },
  });

  // 6) Disponibilidade em lote: o metodo que viabiliza a tela de equipe.
  const ids = usuarios.ok
    ? (usuarios.resultado ?? []).slice(0, 5).map((u) => u.ID).filter(Boolean)
    : [];
  if (ids.length) {
    const hoje = new Date();
    const inicio = hoje.toISOString().slice(0, 10);
    const fim = new Date(hoje.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    await verificar({
      id: "disponibilidade",
      titulo: "Disponibilidade de vários usuários em uma chamada",
      pergunta: "calendar.accessibility.get aceita array de usuários e traz ACCESSIBILITY?",
      metodo: "calendar.accessibility.get",
      parametros: { users: ids, from: inicio, to: fim },
      avaliar: (r) => {
        if (!r.ok) return { veredito: "NAO_CONFIRMADO", evidencia: { erro: r.erro } };
        const chaves = Object.keys(r.resultado ?? {});
        const algumEvento = chaves.flatMap((k) => r.resultado[k] ?? [])[0];
        return {
          veredito: chaves.length > 0 ? "CONFIRMADO" : "PARCIAL",
          evidencia: {
            periodo: { de: inicio, ate: fim },
            usuariosConsultados: ids.length,
            usuariosComResposta: chaves.length,
            camposDoEvento: algumEvento ? Object.keys(algumEvento) : [],
            temAccessibility: algumEvento ? "ACCESSIBILITY" in algumEvento : null,
            observacao: "Uma chamada para N usuarios — viabiliza a tela de equipe.",
          },
        };
      },
    });
  }

  // 7) Seções de calendário: dá para criar seção na empresa?
  await verificar({
    id: "secoes",
    titulo: "Seções de calendário",
    pergunta: "Quais seções existem e o usuário pode escrever nelas? (section.add não aceita company_calendar)",
    metodo: "calendar.section.get",
    parametros: { type: "user" },
    avaliar: (r) => {
      if (!r.ok) return { veredito: "NAO_CONFIRMADO", evidencia: { erro: r.erro } };
      const lista = r.resultado ?? [];
      return {
        veredito: lista.length > 0 ? "CONFIRMADO" : "PARCIAL",
        evidencia: {
          total: lista.length,
          secoes: amostra(
            lista.map((s) => ({
              ID: s.ID,
              NAME: s.NAME,
              CAL_TYPE: s.CAL_TYPE,
              OWNER_ID: s.OWNER_ID,
              PERM: s.PERM,
            })),
            5,
          ),
          observacao: "Usar PERM (do usuário corrente) para decidir se pode lançar evento.",
        },
      };
    },
  });

  // 8) Escrita no calendário — só com autorização explícita.
  if (PERMITIR_ESCRITA) {
    const alvo = primeiroUsuarioId;
    const amanha = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    const criado = await verificar({
      id: "evento-criar",
      titulo: "Criar evento de teste (absent, dia inteiro)",
      pergunta: "calendar.event.add aceita skip_time + accessibility=absent? Retorna ID?",
      metodo: "calendar.event.add",
      parametros: {
        type: "user",
        ownerId: alvo,
        name: "[TESTE SPIKE] Ausencia ficticia - remover",
        description: "Evento criado por spike de validacao. Sem dado real.",
        from: amanha,
        to: amanha,
        skip_time: "Y",
        accessibility: "absent",
        auto_detect_section: "Y",
      },
      avaliar: (r) =>
        r.ok
          ? { veredito: "CONFIRMADO", evidencia: { eventId: r.resultado, dia: amanha } }
          : { veredito: "FALHOU", evidencia: { erro: r.erro, descricao: r.descricao } },
    });

    const eventId = criado.ok ? criado.resultado : null;
    if (eventId) {
      await verificar({
        id: "evento-ler",
        titulo: "Ler o evento criado",
        pergunta: "getbyid devolve o evento com os IDs necessários para update/delete?",
        metodo: "calendar.event.getbyid",
        parametros: { id: eventId },
        avaliar: (r) =>
          r.ok
            ? {
                veredito: "CONFIRMADO",
                evidencia: {
                  ID: r.resultado?.ID,
                  CAL_TYPE: r.resultado?.CAL_TYPE,
                  OWNER_ID: r.resultado?.OWNER_ID,
                  SECTION_ID: r.resultado?.SECTION_ID,
                  ACCESSIBILITY: r.resultado?.ACCESSIBILITY,
                  DT_SKIP_TIME: r.resultado?.DT_SKIP_TIME,
                  tempoTotalMs: r.ms,
                },
              }
            : { veredito: "FALHOU", evidencia: { erro: r.erro } },
      });

      await verificar({
        id: "evento-apagar",
        titulo: "Apagar o evento de teste",
        pergunta: "calendar.event.delete apaga só com o id?",
        metodo: "calendar.event.delete",
        parametros: { id: eventId },
        avaliar: (r) =>
          r.ok
            ? { veredito: "CONFIRMADO", evidencia: { removido: r.resultado } }
            : { veredito: "FALHOU", evidencia: { erro: r.erro, ATENCAO: "evento orfao no portal de teste" } },
      });
    }
  } else {
    resultados.push({
      id: "escrita",
      titulo: "Escrita no calendário",
      pergunta: "calendar.event.add/update/delete funcionam?",
      metodo: "-",
      ok: null,
      veredito: "NAO_EXECUTADO",
      evidencia: { motivo: "rode com --permitir-escrita para criar e remover um evento de teste" },
    });
  }

  finalizar();
}

/* ------------------------------------------------------------- relatório */

function finalizar() {
  const agora = new Date();
  const pasta = path.join(
    import.meta.dirname,
    "..",
    "spike",
    `${agora.toISOString().slice(0, 10)}-${String(agora.getHours()).padStart(2, "0")}${String(agora.getMinutes()).padStart(2, "0")}`,
  );
  fs.mkdirSync(pasta, { recursive: true });

  const confirmados = resultados.filter((r) => r.veredito === "CONFIRMADO").length;
  const parciais = resultados.filter((r) => r.veredito === "PARCIAL").length;
  const falhas = resultados.filter((r) => ["FALHOU", "NAO_CONFIRMADO"].includes(r.veredito)).length;

  const linhas = [
    "# Evidências do spike — Bitrix24",
    "",
    `Executado em: ${agora.toLocaleString("pt-BR")}`,
    `Modo: ${PERMITIR_ESCRITA ? "leitura e escrita" : "somente leitura"}`,
    `Portal: [omitido] · chamadas REST: ${chamadas}`,
    "",
    `Resumo: ${confirmados} confirmado(s), ${parciais} parcial(is), ${falhas} não confirmado(s).`,
    "",
    "## Tabela de evidências",
    "",
    "| # | Verificação | Método | Veredito | Evidência |",
    "|---|---|---|---|---|",
  ];

  for (const r of resultados) {
    const evidencia = JSON.stringify(r.evidencia).replace(/\|/g, "\\|").slice(0, 600);
    linhas.push(`| ${r.id} | ${r.titulo} | \`${r.metodo}\` | ${r.veredito} | \`${evidencia}\` |`);
  }

  linhas.push("", "## Detalhe por verificação", "");
  for (const r of resultados) {
    linhas.push(`### ${r.titulo}`, "", `**Pergunta:** ${r.pergunta}`, "");
    linhas.push(`**Veredito:** ${r.veredito}`, "");
    linhas.push("```json", JSON.stringify(r.evidencia, null, 2), "```", "");
  }

  linhas.push(
    "## Notas",
    "",
    "- Nenhum token, webhook ou dado de cliente real aparece neste arquivo.",
    "- Vereditos `NAO_CONFIRMADO` são resultado legítimo: significam hipótese derrubada, não falha do script.",
    "- Revisar o plano BR24-002 com estes resultados antes de qualquer código do domínio.",
    "",
  );

  fs.writeFileSync(path.join(pasta, "evidencias.md"), linhas.join("\n"));
  fs.writeFileSync(path.join(pasta, "resultados.json"), JSON.stringify(resultados, null, 2));

  console.log(`\nResultado: ${confirmados} confirmado(s), ${parciais} parcial(is), ${falhas} não confirmado(s).`);
  console.log(`Evidências: ${path.relative(process.cwd(), path.join(pasta, "evidencias.md"))}`);
}

principal().catch((erro) => {
  console.error("Falha inesperada no spike:", erro.message);
  process.exit(1);
});
