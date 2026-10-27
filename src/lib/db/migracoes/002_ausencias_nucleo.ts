/**
 * Migracao 002 — nucleo de Ferias e Ausencias (BR24-005 v2.2).
 * Tipos, equipes, pessoas, pedidos, lancamentos, etapas, notificacoes,
 * pedido_dia (defesa em profundidade contra sobreposicao) e auditoria.
 *
 * Regras de modelagem:
 *  - TODA tabela leva `portal_member_id TEXT NOT NULL REFERENCES portal ON
 *    DELETE CASCADE` e todo indice comeca por ele (multi-tenant + cascata).
 *  - Chaves naturais (pessoa/equipe/tipo/etapa) sao por portal:
 *    PRIMARY KEY (portal_member_id, id). Pedido e lancamento usam
 *    AUTOINCREMENT, com UNIQUE (portal_member_id, id) para FKs compostas.
 *  - FKs compostas (portal_member_id, x) impedem referencia entre tenants.
 *  - `origem` = 'app' | 'seed' (a seed so toca linhas que ela mesma criou).
 *  - `motivo_privado_enc` guarda o motivo CIFRADO (encrypt() de lib/crypto);
 *    nunca texto puro. Debito de saldo NAO e persistido: deriva de pedido.
 *  - Sem tabela de acesso extra de gestor/substituto: backlog (v2.1).
 *
 * NUNCA editar depois de aplicada: mudancas viram uma migracao nova.
 */
export const nome = "002_ausencias_nucleo";

export const sql = `
      CREATE TABLE IF NOT EXISTS tipo (
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        id               TEXT NOT NULL,
        nome             TEXT NOT NULL,
        quem_pede        TEXT NOT NULL CHECK (quem_pede IN ('todos', 'admin')),
        consome_saldo    TEXT CHECK (consome_saldo IS NULL OR consome_saldo IN ('ferias', 'folga')),
        sensivel         INTEGER NOT NULL DEFAULT 0 CHECK (sensivel IN (0, 1)),
        cor              TEXT NOT NULL,
        origem           TEXT NOT NULL DEFAULT 'app' CHECK (origem IN ('app', 'seed')),
        PRIMARY KEY (portal_member_id, id)
      );

      CREATE TABLE IF NOT EXISTS equipe (
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        id               TEXT NOT NULL,
        nome             TEXT NOT NULL,
        gestor_id        TEXT NOT NULL,
        minimo_pessoas   INTEGER NOT NULL DEFAULT 1 CHECK (minimo_pessoas >= 1),
        contar_pendentes INTEGER NOT NULL DEFAULT 0 CHECK (contar_pendentes IN (0, 1)),
        origem           TEXT NOT NULL DEFAULT 'app' CHECK (origem IN ('app', 'seed')),
        PRIMARY KEY (portal_member_id, id),
        -- Ciclo equipe <-> pessoa: so conferido no COMMIT.
        FOREIGN KEY (portal_member_id, gestor_id)
          REFERENCES pessoa (portal_member_id, id) DEFERRABLE INITIALLY DEFERRED
      );

      CREATE TABLE IF NOT EXISTS pessoa (
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        id               TEXT NOT NULL,
        nome             TEXT NOT NULL,
        equipe_id        TEXT NOT NULL,
        papel            TEXT NOT NULL CHECK (papel IN ('colaborador', 'gestor', 'admin')),
        aprovador_id     TEXT NOT NULL,
        funcao           TEXT,
        bitrix_user_id   INTEGER,
        origem           TEXT NOT NULL DEFAULT 'app' CHECK (origem IN ('app', 'seed')),
        PRIMARY KEY (portal_member_id, id),
        CHECK (aprovador_id <> id),
        FOREIGN KEY (portal_member_id, equipe_id)
          REFERENCES equipe (portal_member_id, id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (portal_member_id, aprovador_id)
          REFERENCES pessoa (portal_member_id, id) DEFERRABLE INITIALLY DEFERRED
      );
      CREATE INDEX IF NOT EXISTS idx_pessoa_equipe ON pessoa (portal_member_id, equipe_id);
      CREATE INDEX IF NOT EXISTS idx_equipe_gestor ON equipe (portal_member_id, gestor_id);

      CREATE TABLE IF NOT EXISTS pedido (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_member_id     TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        pessoa_id            TEXT NOT NULL,
        tipo_id              TEXT NOT NULL,
        inicio               TEXT NOT NULL,
        fim                  TEXT NOT NULL,
        dias_uteis           INTEGER NOT NULL CHECK (dias_uteis >= 0),
        -- JSON {"2026": 3, "2027": 5}: debito por ano de competencia (congelado na criacao).
        dias_debito_por_ano  TEXT NOT NULL DEFAULT '{}',
        status               TEXT NOT NULL DEFAULT 'pendente'
                               CHECK (status IN ('pendente', 'aprovada', 'recusada', 'cancelada')),
        sincronizacao        TEXT NOT NULL DEFAULT 'nao_aplicavel'
                               CHECK (sincronizacao IN ('nao_aplicavel', 'pendente', 'em_andamento', 'ok',
                                                        'falha', 'remocao_pendente', 'removido', 'falha_manual')),
        justificativa        TEXT,
        -- Motivo de tipo sensivel: CIFRADO (AES-256-GCM). Nunca em texto puro.
        motivo_privado_enc   TEXT,
        excede_saldo         INTEGER NOT NULL DEFAULT 0 CHECK (excede_saldo IN (0, 1)),
        motivo_decisao       TEXT,
        sugestao_inicio      TEXT,
        sugestao_fim         TEXT,
        prazo_em             TEXT,
        criado_em            TEXT NOT NULL,
        decidido_por         TEXT,
        decidido_em          TEXT,
        cancelado_em         TEXT,
        cancelado_por        TEXT,
        bitrix_event_id      TEXT,
        owner_id             INTEGER,
        secao                INTEGER,
        versao               INTEGER NOT NULL DEFAULT 0 CHECK (versao >= 0),
        origem               TEXT NOT NULL DEFAULT 'app' CHECK (origem IN ('app', 'seed')),
        UNIQUE (portal_member_id, id),
        CHECK (inicio <= fim),
        CHECK ((sugestao_inicio IS NULL) = (sugestao_fim IS NULL)),
        CHECK (sugestao_inicio IS NULL OR status = 'recusada'),
        -- Par (status, sincronizacao) valido segundo BR24-005 v2.2.
        CHECK (
          (status IN ('pendente', 'recusada') AND sincronizacao = 'nao_aplicavel') OR
          (status = 'aprovada' AND sincronizacao IN ('pendente', 'em_andamento', 'ok', 'falha', 'falha_manual')) OR
          (status = 'cancelada' AND sincronizacao IN ('nao_aplicavel', 'remocao_pendente', 'em_andamento',
                                                      'removido', 'falha', 'falha_manual'))
        ),
        FOREIGN KEY (portal_member_id, pessoa_id) REFERENCES pessoa (portal_member_id, id),
        FOREIGN KEY (portal_member_id, tipo_id) REFERENCES tipo (portal_member_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_pedido_pessoa  ON pedido (portal_member_id, pessoa_id, status);
      CREATE INDEX IF NOT EXISTS idx_pedido_status  ON pedido (portal_member_id, status, criado_em);
      CREATE INDEX IF NOT EXISTS idx_pedido_periodo ON pedido (portal_member_id, inicio, fim);

      -- Credito/ajuste de saldo. O debito e derivado dos pedidos (sem linha 'debito').
      CREATE TABLE IF NOT EXISTS lancamento (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        pessoa_id        TEXT NOT NULL,
        ano              INTEGER NOT NULL CHECK (ano BETWEEN 1900 AND 2200),
        carteira         TEXT NOT NULL CHECK (carteira IN ('ferias', 'folga')),
        tipo             TEXT NOT NULL CHECK (tipo IN ('credito', 'ajuste')),
        dias             INTEGER NOT NULL CHECK (dias <> 0 AND (tipo = 'ajuste' OR dias > 0)),
        motivo           TEXT NOT NULL,
        vence_em         TEXT,
        criado_por       TEXT NOT NULL,
        criado_em        TEXT NOT NULL,
        origem           TEXT NOT NULL DEFAULT 'app' CHECK (origem IN ('app', 'seed')),
        -- Chave natural para idempotencia da seed (NULL = lancamento comum).
        chave_natural    TEXT,
        UNIQUE (portal_member_id, chave_natural),
        FOREIGN KEY (portal_member_id, pessoa_id) REFERENCES pessoa (portal_member_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_lancamento_pessoa ON lancamento (portal_member_id, pessoa_id, carteira, ano);

      -- 4 pontos fixos; rotulo, mensagem (so variaveis da whitelist) e prazo editaveis.
      CREATE TABLE IF NOT EXISTS etapa (
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        chave            TEXT NOT NULL CHECK (chave IN ('enviado', 'com_gestor', 'confirmado', 'recusado')),
        rotulo           TEXT NOT NULL,
        mensagem         TEXT NOT NULL,
        prazo_horas      INTEGER CHECK (prazo_horas IS NULL OR prazo_horas BETWEEN 1 AND 168),
        origem           TEXT NOT NULL DEFAULT 'app' CHECK (origem IN ('app', 'seed')),
        PRIMARY KEY (portal_member_id, chave)
      );

      -- Caixa de notificacoes do app. Unica por (pessoa, pedido, etapa).
      CREATE TABLE IF NOT EXISTS notificacao (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        pessoa_id        TEXT NOT NULL,
        pedido_id        INTEGER NOT NULL,
        etapa            TEXT NOT NULL,
        texto            TEXT NOT NULL,
        criada_em        TEXT NOT NULL,
        lida             INTEGER NOT NULL DEFAULT 0 CHECK (lida IN (0, 1)),
        UNIQUE (portal_member_id, pessoa_id, pedido_id, etapa),
        FOREIGN KEY (portal_member_id, pessoa_id) REFERENCES pessoa (portal_member_id, id) ON DELETE CASCADE,
        FOREIGN KEY (portal_member_id, pedido_id) REFERENCES pedido (portal_member_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_notificacao_pessoa ON notificacao (portal_member_id, pessoa_id, criada_em);

      -- Um dia util ocupado por no maximo UM pedido pendente|aprovado da pessoa.
      -- Serve tambem a cobertura. Esvaziada ao recusar/cancelar.
      CREATE TABLE IF NOT EXISTS pedido_dia (
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        pessoa_id        TEXT NOT NULL,
        dia              TEXT NOT NULL,
        pedido_id        INTEGER NOT NULL,
        UNIQUE (portal_member_id, pessoa_id, dia),
        FOREIGN KEY (portal_member_id, pessoa_id) REFERENCES pessoa (portal_member_id, id) ON DELETE CASCADE,
        FOREIGN KEY (portal_member_id, pedido_id) REFERENCES pedido (portal_member_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pedido_dia_dia    ON pedido_dia (portal_member_id, dia);
      CREATE INDEX IF NOT EXISTS idx_pedido_dia_pedido ON pedido_dia (portal_member_id, pedido_id);

      -- Trilha de auditoria. Sem FK para o ator (historico sobrevive a mudancas).
      -- \`detalhe\` nunca recebe motivo/justificativa (o repositorio mascara).
      CREATE TABLE IF NOT EXISTS auditoria (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_member_id TEXT NOT NULL REFERENCES portal(member_id) ON DELETE CASCADE,
        em               TEXT NOT NULL,
        ator_id          TEXT,
        acao             TEXT NOT NULL,
        entidade         TEXT NOT NULL,
        entidade_id      TEXT,
        detalhe          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_auditoria_em       ON auditoria (portal_member_id, em);
      CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria (portal_member_id, entidade, entidade_id);
    `;
