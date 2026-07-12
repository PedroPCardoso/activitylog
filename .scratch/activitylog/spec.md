# Spec: activitylog — trilha de auditoria agnóstica de ORM (0.1 TypeORM + 0.2 Prisma)

Status: ready-for-agent

> Vocabulário: [`CONTEXT.md`](../../CONTEXT.md). Decisões travadas: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) (D1–D17). Mapa Wayfinder: [`map.md`](./map.md).

## Problem Statement

Quem desenvolve em TypeScript/NestJS não tem uma trilha de auditoria com a DX do `spatie/laravel-activitylog` (48M installs no PHP). Os 12+ pacotes que tentaram em 2025–2026 morreram: cada um apostou num único ORM e quebrou no churn de majors, mandaram o dev fiar o contexto do usuário sozinho, nunca resolveram o diff race-safe em escritas bulk/nested, e vieram com licenças ruins ou sem repo. O resultado: o dev acaba escrevendo triggers no Postgres (que quebram com PgBouncer e não sabem *quem* causou a mudança) ou espalhando `INSERT`s de auditoria manuais e inconsistentes pelo código — e frequentemente **vazando senha/PII para dentro do próprio log de auditoria**.

## Solution

Uma biblioteca cujo **core não conhece nenhum ORM nem o NestJS**, com adapters first-class por ORM. O desenvolvedor marca a entidade (`@LogsActivity()` no TypeORM) ou estende o client (Prisma), e ganha: **Causer** resolvido automaticamente do contexto, **Diff** old/new, **Batches**, **Query API** tipada e **Redaction** de campos sensíveis por padrão. A promessa central é o invariante **iff-committed**: uma **Activity** persiste se e somente se a mutação que a causou commitou (quando transacional) — a auditoria nunca deixa órfão nem perde registro. Onde uma garantia não é possível (ex.: `$extends` do Prisma em mutação solta), a biblioteca **declara honestamente** via uma matriz de cobertura em vez de fingir.

## User Stories

1. Como dev, quero registrar uma atividade manualmente com uma API fluente (`activity('billing').performedOn(...).causedBy(...).withProperties(...).event('subscribed').log('...')`), para auditar ações que não são mutações de ORM.
2. Como dev, quero omitir `.causedBy()` e ter o **Causer** resolvido automaticamente do contexto da request, para não fiar o usuário à mão em cada chamada.
3. Como dev de TypeORM, quero anotar uma entidade com `@LogsActivity(options)`, para que `save`/`remove`/`softRemove` gerem Activities automaticamente.
4. Como dev de TypeORM, quero um helper `auditedUpdate(repo, criteria, patch)`, para auditar `.update()`/QueryBuilder (que o subscriber não pega) com re-read + diff na mesma transação.
5. Como dev de Prisma, quero um client `$extends`-ado (`prismaActivityLog(prisma, options)`) que audita `create`/`update`/`delete`/`upsert`, para não instrumentar cada chamada.
6. Como dev de Prisma, quero um `auditedTransaction(prisma, fn)` que garanta **iff-committed**, para os casos em que a atomicidade da auditoria importa.
7. Como auditor, quero que cada Activity registre **Subject** (`performedOn`), **Causer** (`causedBy`), **Event**, **Log name**, **Diff** e timestamp, para reconstruir o que aconteceu, com quem e quando.
8. Como dev, quero configurar `logOnly`/`logExcept`/`logOnlyDirty`/`dontSubmitEmptyLogs`/`useLogName`/`descriptionForEvent`, para controlar exatamente o que é logado (paridade Spatie).
9. Como dev, quero agrupar Activities num **Batch** via `withBatch(fn)`, para correlacionar tudo que aconteceu numa mesma unidade de trabalho por um `batch_uuid`.
10. Como dev, quero `withoutLogging(fn)` e `disableLogging()/enableLogging()`, para suprimir auditoria em migrações/seeds/jobs internos.
11. Como dev, quero consultar Activities com uma **Query API** tipada (`forSubject`/`causedBy`/`inLog`/`forEvent`/`forBatch`/`between`/`paginate`), para construir telas de histórico.
12. Como responsável por compliance, quero que campos sensíveis (senha, token, PII) sejam **redigidos por padrão** antes de tocar a store, para que a trilha de auditoria não vire um vazamento.
13. Como dev, quero poder estender/desativar a lista de redaction, para adaptar aos meus campos sem perder o default seguro.
14. Como dev, quero um hook `beforePersist(activity, ctx)`, para enriquecer a Activity — sabendo que a redaction ainda tem a palavra final.
15. Como operador, quero que uma transação que faz rollback **não** deixe Activity órfã, para confiar na trilha.
16. Como dev de Prisma, quero saber exatamente **onde vale iff-committed e onde é best-effort** (matriz de cobertura), para não presumir garantias que não existem.
17. Como dev, quero que operações em massa (`updateMany`, nested writes) gerem **uma Aggregate activity** (`subject_id=null` + criteria/changes/affected), para não ter diff falso por linha nem explosão de registros.
18. Como dev, quero poder incluir/excluir Aggregate activities na Query API, porque relatórios geralmente querem um ou outro.
19. Como dev NestJS, quero `ActivityLogModule.forRoot(...)`/`forFeature(...)` com precedência **chamada > forFeature > forRoot > default**, para configurar store/logName/causer/redact por escopo.
20. Como dev NestJS, quero um `ActivityLogService` injetável como façade, para usar a biblioteca via DI idiomática.
21. Como dev NestJS, quero que a ALS seja aberta no middleware e o Causer resolvido lazy no `.log()`, para que `request.user` (setado pelo guard) esteja disponível sem depender do timing do RxJS.
22. Como dev que usa filas (BullMQ), quero `serializeContext()`/`runWithContext()`, para propagar Causer/Batch pela fronteira do job (a ALS não cruza).
23. Como dev, quero que um job sem contexto reestabelecido registre Causer nulo (system), nunca um Causer adivinhado/vazado.
24. Como dev, quero **migrations de referência** por dialeto (SQL puro pg/mysql/sqlite + entity TypeORM + schema Prisma), porque a biblioteca fornece o schema mas não roda migrations.
25. Como dev, quero customizar `tableName` e injetar uma `store` própria, para adaptar ao meu banco.
26. Como dev, quero que um `tableName` malicioso seja rejeitado por validação de identificador, para não abrir injeção de SQL.
27. Como dev que usa Hono/Fastify (sem Nest), quero usar o `activitylog-core` direto, porque o core é agnóstico de framework.
28. Como dev, quero instalar só o pacote do meu framework (`activitylog-nestjs` ou `activitylog-nextjs`) com o core como dependência compartilhada, sem duplicação de estado.
29. Como dev, quero PK `bigint` por padrão (compacta, cronológica) e opção `uuid` v7, para escolher conforme meu cenário.
30. Como dev, quero `properties` num tipo consultável (`jsonb`/`JSON`/`TEXT`), para filtrar por conteúdo no futuro.
31. Como maintainer, quero paridade verificável com cada exemplo do README do Spatie (seção manual logging) rodando nos 3 dialetos, para provar a paridade.
32. Como dev, quero **DIVERGENCES.md** documentando os desvios deliberados vs Spatie, para saber onde nós diferimos e por quê.

## Implementation Decisions

**Pacotes (D15):** exatamente três, base neutra `activitylog-`. `activitylog-core` (agnóstico), `activitylog-nestjs` (módulo Nest + adapter TypeORM como subpath interno), `activitylog-nextjs` (adapter Prisma como subpath interno; Drizzle depois). **Nunca** pacote por ORM. Empacotamento CJS-only + subpaths + stubs físicos espelhando o `nestjs-metrics`.

**Restrição de estado (D5):** o `activitylog-core` carrega uma única instância de `AsyncLocalStorage`. Deve ser dependência **compartilhada e deduplicada** — `external` no tsup dos leaves, nunca bundled. Duplicar o core em memória faz o Causer sumir silenciosamente entre adapters.

**Core — duas costuras ortogonais (D2):**
- `ActivityStore` — onde as Activities são gravadas. Implementação única `SqlExecutorStore` que emite SQL parametrizado, reusando os dialects pg/mysql/sqlite e `assertSafeIdentifier` do metrics. O `TransactionRef` passado a `persist()` é um executor SQL **ligado à transação viva** do ORM (é assim que o iff-committed é honrado; no caminho manual/standalone é um pool próprio, best-effort). Assinatura congelada no 0.x (D12):

  ```ts
  interface ActivityStore {
    persist(activities: NewActivity[], ctx?: TransactionRef): Promise<void>;
    query(filter: ActivityFilter): Promise<Activity[]>;
    prune(olderThan: Date, logName?: string): Promise<number>;
  }
  ```
- `CauserResolver` — quem causou, sobre ALS pura no core (sem dependência de nestjs-cls).

**Módulos do core:** `ActivityLogger` (API fluente manual), `DiffEngine`, `activityQuery()` (Query API tipada), context (ALS/batch/withoutLogging), enums, exceptions (estendem `Error`, mensagem prefixada `activitylog: …`).

**Identidade (D4):** `subject_type`/`causer_type` = **Type** string opaca (default nome da classe, sobreponível por **Morph map**); `subject_id`/`causer_id` = `varchar` universal (PK stringificada). Tipagem forte só no TS (`subjectRef<T>`). PK composta fora de escopo.

**iff-committed (D1, D3):** invariante definidor — Activity persiste sse a mutação commitar, quando transacional. Garantido **só pelos helpers explícitos de transação** (`auditedUpdate` TypeORM, `auditedTransaction` Prisma). Decorator/`$extends` são conveniência **best-effort com lacunas documentadas**. Uma **matriz de cobertura** declara, por adapter × operação, onde vale iff e onde é best-effort.

**Old-values (D8):** sem lock por default (ideia do Spatie); "**Old**" = a linha visível na tx imediatamente antes do UPDATE. `lockForDiff: true` opt-in para exatidão sob concorrência.

**Aggregate activity (D9):** operação em massa → 1 Activity com `subject_id=null`, `subject_type`=model, `properties={aggregate:true, criteria, changes, affected}`, sem `old`. Nunca expandir em N linhas por default. Query API ganha scope pra incluir/excluir agregados.

**Pipeline de escrita (D16):** ordem fixa `capturar diff → beforePersist(hook) → redaction → persist`. Redaction é o guardião final; o hook não a desliga.

**Redaction (D14):** deny-by-default — lista de nomes sensíveis embutida (sobreponível/desativável), match por nome, **deep**, case-insensitive; valor → `'[REDACTED]'`. Fail secure. Roda antes de persistir e antes de qualquer log.

**Segurança/injeção (D13):** `tableName` e nomes de coluna customizáveis passam por `assertSafeIdentifier` (choke point único); `subject_type`/`causer_type`/`event`/`log_name`/`subject_id`/`properties` são sempre bind params. Uma `store` custom externa é responsabilidade de segurança do usuário.

**NestJS:** `DynamicModule` manual (sem ConfigurableModuleBuilder), tokens `ACTIVITYLOG_ROOT_OPTIONS`/`ACTIVITYLOG_FEATURE_OPTIONS`, `ActivityLogService` façade com precedência **chamada > forFeature > forRoot > default**. ALS aberta no middleware; Causer resolvido lazy no `.log()` (D6); interceptor como alternativa secundária.

**Filas (D7):** `serializeContext()`/`runWithContext(serialized, fn)`; default sem contexto = Causer nulo.

**Schema (§6, D10, D11):** `id` (bigint default / uuid v7 configurável), `log_name` (indexado), `description`, `subject_type`+`subject_id` (índice composto), `causer_type`+`causer_id` (índice composto), `event`, `properties` (`jsonb`/`JSON`/`TEXT`), `batch_uuid`, `created_at`. Migrations de referência por dialeto — a biblioteca fornece, não roda.

**Sequência (D17):** TypeORM ancora o 0.1; Prisma fast-follow 0.2.

## Testing Decisions

**Uma seam única (confirmada):** os testes dirigem operações reais pelos entrypoints públicos contra um datasource real e afirmam sobre as **Activities persistidas** (lidas de volta via `store.query()` / Query API) e sobre exceptions lançadas. **Nunca** afirmam sobre chamadas internas do `DiffEngine`, estado da ALS ou detalhes de implementação — só comportamento externo observável. A `store.query()` (seam de leitura que já existe no design) dobra como ponto de observação; sem hooks de teste dedicados.

**Bancos:** SQLite `:memory:` sempre; PG/MySQL gated por `PG_HOST`/`MYSQL_HOST` (idêntico ao metrics). Vitest 2 na raiz, aliases → src, `globals:false`, `fileParallelism:false`. e2e Nest via `Test.createTestingModule`.

**Módulos testados / casos:**
- **Logger manual:** cada exemplo do README do Spatie (manual logging) reproduzido nos 3 dialetos.
- **Contexto:** propagação assíncrona (Promise.all, setTimeout), nested batches, `withoutLogging`.
- **Query API:** paridade com scopes `inLog/causedBy/forSubject/forEvent/forBatch` + paginação + inclusão/exclusão de agregados.
- **Nest:** precedência chamada/feature/root/default.
- **Adapter TypeORM:** matriz de cobertura (`save`/`remove`/`softRemove` ✅; `update`/QB ⚠️→`auditedUpdate`).
- **Adapter Prisma:** SQLite + PG; **teste explícito de rollback** (Activity não persiste se a tx falhar).
- **Domínio específico:** rollback não deixa órfão (iff); **race** de SELECT-before-update documentada com teste que demonstra o comportamento; injeção via `tableName` rejeitada; redaction verificada no `properties` persistido; guarda de instância única do core (D5).
- **Prior art:** `test/nestjs.spec.ts` e `test/helpers/orders-datasource.ts` do `nestjs-metrics`.

**DoD de cobertura:** ≥85% no core.

## Out of Scope

- **Adapter Drizzle** (0.3) e **Mongoose** (fase 8+).
- **Modo outbox/async** (1.0, D12) — o `ActivityStore` fica com a assinatura congelada que o comporta depois, mas nada de worker/ordenação agora.
- **`prune()` + CLI de launch** — a interface `prune()` existe na store, mas a CLI `activitylog prune` e docs de launch ficam para depois de publicar 0.1/0.2.
- **PK composta** de Subject/Causer.
- **Um pacote por ORM** — explicitamente rejeitado (D15).
- Filtro tipado *dentro* de `properties` na Query API — a profundidade da tipagem é decisão em aberto (ticket 01); o 0.x pode entregar filtro string livre.

## Further Notes

- **DIVERGENCES.md** documenta desvios deliberados vs Spatie: sem eventos Eloquent globais (cobertura por matriz); `properties` sempre `{attributes, old}`; redaction nativa; base para outbox.
- Release via Changesets two-phase no `master` com provenance npm; CI inteira em Docker (install → lint → typecheck → up DBs → test → build).
- Decisões em aberto residuais estão como tickets na frontier do mapa Wayfinder (01–06); resolver antes das fases de build correspondentes.
- Honestidade sobre cobertura é o diferencial central — a matriz de cobertura por adapter deve ser tratada como entregável de primeira classe, não nota de rodapé.
