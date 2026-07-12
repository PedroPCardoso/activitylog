# Plano de Execução — "activitylog" para TypeScript/NestJS

**Referências:** [spatie/laravel-activitylog](https://github.com/spatie/laravel-activitylog) (spec funcional, ~48M installs) · `nestjs-metrics` (padrão de codebase e projeto, em `/Users/pedrocardoso/Develop/nestjs-metrics`) · pesquisa adversarial jul/2026 (gap confirmado: nenhum incumbente >2,4k dl/sem; prisma#1902 aberta desde 2020; typeorm#4537 aberta há 7 anos).

---

## 1. Visão e posicionamento

Trilha de auditoria de entidades, ORM-agnóstica, com a DX do Spatie: `@LogsActivity()` no model, causer resolvido automaticamente, diffs old/new, batches, query API tipada. O core não conhece nenhum ORM nem o NestJS — exatamente como o `MetricsBuilder` não conhece o Nest.

**Diferenciais que os 12+ pacotes falhos de 2025–2026 não entregaram** (usar como checklist de "por que nós ganhamos"):

1. Core agnóstico + adapters first-class (todos apostaram num ORM só e morreram no churn de majors).
2. Causer resolution pronta via CLS/ALS (todos mandam o usuário fiar o contexto sozinho).
3. Estratégia documentada e race-safe para diffs em bulk/nested writes (o problema duro; ninguém resolveu).
4. Licença MIT + Changesets + provenance + docs (falhas reais dos concorrentes: GPL-3, UNLICENSED, sem repo).

## 2. Estrutura do monorepo (espelho do nestjs-metrics)

```
activitylog/
├─ package.json                 # private "activitylog-monorepo", npm workspaces
├─ tsconfig.base.json           # ES2021, CommonJS, strict, decorators
├─ tsconfig.json                # noEmit + paths → src dos pacotes
├─ vitest.config.ts             # única run, aliases → src, fileParallelism: false
├─ .eslintrc.json               # eslint:recommended + ts-recommended, no-explicit-any off
├─ .changeset/config.json       # baseBranch master, access public, updateInternal patch
├─ docker-compose.yml + Dockerfile.dev
├─ .github/workflows/{ci.yml,release.yml}
├─ docs/{ARCHITECTURE.md, RELEASING.md}
├─ CLAUDE.md, AGENTS.md         # idênticos
├─ DIVERGENCES.md               # desvios documentados vs spatie
├─ laravel-activitylog/         # vendorizar o original PHP como referência de paridade
├─ test/                        # TODOS os specs na raiz (*.spec.ts) + test/helpers/
└─ packages/
   ├─ core/                     # nestjs-activitylog-core
   │  └─ src/{logger,diff,context,store,query,enums,exceptions,types}/
   ├─ nestjs-activitylog/       # módulo NestJS + subscriber TypeORM
   │  └─ src/{index.ts, nestjs/*, typeorm/*}
   └─ nextjs-activitylog/       # adapters Prisma + Drizzle
      └─ src/{index.ts, prisma/index.ts, drizzle/index.ts}
```

Convenções herdadas na íntegra: CJS-only (`"type": "commonjs"`, exports com `require`+`types`, tsup `format:['cjs']`, `dts:true`, `target:'node18'`); um entry tsup por subpath + stub físico `<subpath>/package.json` mantido em `files`; peers opcionais via `peerDependenciesMeta`; `publishConfig: { access: public, provenance: true }`; `engines.node >= 18`; façade re-export (`export * from 'nestjs-activitylog-core'` nos leaf packages); exceptions estendendo `Error` nativo com mensagens prefixadas `nestjs-activitylog: …`; tokens `Symbol('SCREAMING_SNAKE')`; arquivos kebab-case com sufixo de papel (`*.logger.ts`, `*.store.ts`, `*.adapter.ts`).

## 3. Arquitetura do core (as duas costuras estratégicas)

Espelhando o padrão `QueryBackend` + `SqlDialect` do metrics, o core tem duas interfaces ortogonais:

**`ActivityStore`** (onde as atividades são gravadas) — análogo ao `QueryBackend`:

```ts
export interface ActivityStore {
  persist(activities: NewActivity[], ctx?: TransactionRef): Promise<void>;
  query(filter: ActivityFilter): Promise<Activity[]>;   // alimenta a query API
  prune(olderThan: Date, logName?: string): Promise<number>;
}
```

Implementações: `SqlExecutorStore` (SQL parametrizado via `(sql, params) => rows`, mesmo seam `DataSource { dialect, execute }` do metrics — reutilizar o conceito de dialects postgres/mysql/sqlite e o `assertSafeIdentifier`), e stores plugáveis futuros (outbox/async, ClickHouse, S3 append-only). Modo default: **sync-in-tx** (gravar na mesma transação da mutação); modo **async-outbox** opcional — o tradeoff consistência × throughput explícito, não implícito.

**`CauserResolver`** (quem causou) — camada de contexto sobre `AsyncLocalStorage` puro no core (`context/als.ts`), sem dependência de nestjs-cls no core. O pacote NestJS liga isso num middleware/interceptor.

**`ActivityLogger`** — API manual (paridade com o helper `activity()` do Spatie):

```ts
await activity('billing')
  .performedOn(subjectRef('Order', order.id))
  .causedBy(causerRef('User', userId))          // ou omitir → resolve do contexto
  .withProperties({ plan: 'pro' })
  .event('subscribed')
  .log('Assinatura criada');
```

**`DiffEngine`** — calcula `properties.attributes`/`properties.old` com `logOnly`/`logExcept`/`logOnlyDirty`/`dontSubmitEmptyLogs`, mascaramento por campo (`redact: ['password']`) e serialização segura (datas, decimals, relations por id).

**Query API tipada** (paridade + além do Spatie):

```ts
const acts = await activityQuery(store)
  .forSubject('Order', id).causedBy('User', adminId)
  .inLog('billing').forEvent('updated').forBatch(batchId)
  .between(from, to).paginate(50);
```

**Batches** — `startBatch()`/`withBatch(fn)` sobre ALS gerando UUID compartilhado (paridade com `LogBatch`).

**Escape hatches** — `withoutLogging(fn)` (ALS flag), `disableLogging()/enableLogging()` globais.

## 4. Camada NestJS (padrão exato do metrics)

`DynamicModule` manual, sem ConfigurableModuleBuilder:

```ts
ActivityLogModule.forRoot({           // global: true, exporta o token root
  store: ..., logName: 'default',
  causer: { resolve: (ctx) => ctx.user && causerRef('User', ctx.user.id) },
  redact: ['password', 'token'],
})
ActivityLogModule.forFeature({ logName: 'billing' })   // escopo por feature
```

Tokens `ACTIVITYLOG_ROOT_OPTIONS` / `ACTIVITYLOG_FEATURE_OPTIONS`; `ActivityLogService` como façade `@Injectable()` com `@Optional() @Inject` nos dois tokens e precedência **opção da chamada > forFeature > forRoot > default** (mesmo contrato testado do metrics). Interceptor opcional `ActivityContextInterceptor` popula o ALS com o causer a partir do `request.user` — único ponto onde o pacote toca HTTP.

## 5. Adapters de ORM (duck-typed, lazy, como no nextjs-metrics)

- **TypeORM** (`nestjs-activitylog/typeorm`): `@LogsActivity(options)` decorator de classe + `ActivityLogSubscriber`. **Documentar de frente as lacunas do subscriber** (não dispara em `.update()`/QueryBuilder/bulk — typeorm#4537) e oferecer o complemento explícito `auditedUpdate(repo, criteria, patch)` que faz re-read + diff na mesma transação via `event.manager`. Honestidade sobre cobertura é diferencial, não fraqueza.
- **Prisma** (`nextjs-activitylog/prisma`): `prismaActivityLog(prisma, options)` retornando client `$extends`-ado. Estratégia de old values: re-read na mesma transação interativa quando disponível; senão SELECT-before-update com aviso documentado de race; `updateMany`/nested writes → registrar como evento agregado com criteria (sem fingir diff por linha). Duck-type `PrismaClientLike`, peer `@prisma/client: "*"` opcional.
- **Drizzle** (`nextjs-activitylog/drizzle`): wrapper sobre as query APIs usando `RETURNING` (postgres/sqlite) para capturar new values sem SELECT extra — a vantagem técnica do Drizzle aqui; `drizzle-orm` carregado lazy via `require()` para auto-detecção de dialeto, como no metrics.
- **Mongoose**: fora do escopo inicial (fase 8+, se houver demanda).

## 6. Schema padrão (paridade com a tabela `activity_log` do Spatie)

`id`, `log_name` (indexado), `description`, `subject_type` + `subject_id` (índice composto), `causer_type` + `causer_id` (índice composto), `event`, `properties` (JSON/JSONB), `batch_uuid`, `created_at`. Entregar migrations de referência (SQL puro por dialeto + snippet Prisma schema + tabela TypeORM entity + Drizzle table) — o pacote não roda migrations, fornece-as.

## 7. Fases de execução

| Fase | Entrega | DoD (definition of done) |
|---|---|---|
| **0. Bootstrap** (~2-3 dias) | Monorepo clonando a config do metrics (workspaces, tsup, vitest, eslint, docker, changesets, CI); vendorizar laravel-activitylog; ARCHITECTURE.md com tabela de decisões estilo "grilling" (CJS-only, sync-in-tx default, nomes dos pacotes) | `npm run lint/typecheck/test/build` verdes no Docker; changeset publica 0.0.1 dry-run |
| **1. Core: logger manual + store SQL** (~1-2 sem) | `ActivityLogger` fluente, `SqlExecutorStore` com dialects pg/mysql/sqlite, schema + migrations de referência, `assertSafeIdentifier`, exceptions | Specs de paridade: cada exemplo do README do Spatie (seção "manual logging") reproduzido em `test/logger.spec.ts` nos 3 dialetos (SQLite sempre; PG/MySQL gated por env, como no metrics) |
| **2. Contexto: causer + batch + withoutLogging** (~1 sem) | ALS no core; `withBatch`, `withoutLogging`, resolução de causer | Specs de propagação assíncrona (Promise.all, setTimeout), nested batches |
| **3. Query API** (~1 sem) | `activityQuery()` tipada com todos os scopes do Spatie + paginação | Paridade com scopes `inLog/causedBy/forSubject/forEvent/forBatch` |
| **4. Módulo NestJS** (~1 sem) | `ActivityLogModule.forRoot/forFeature`, service façade, interceptor de contexto, subpath `/nestjs` + stub | e2e com `@nestjs/testing` cobrindo precedência root/feature/chamada (mesmo estilo de `nestjs.spec.ts` do metrics) |
| **5. Adapter TypeORM** (~1-2 sem) | `@LogsActivity` + subscriber + `auditedUpdate`; `LogOptions` completo (logOnly, logExcept, logOnlyDirty, dontSubmitEmptyLogs, useLogName, descriptionForEvent, redact) | Matriz de cobertura documentada (save/remove/softRemove ✅, update/QB ⚠️→auditedUpdate); specs com datasource dos helpers |
| **6. Adapter Prisma** (~1-2 sem) | `$extends` com create/update/delete/upsert + estratégia bulk/nested documentada | Specs com SQLite + PG; teste explícito de rollback (atividade não persiste se a tx falhar) |
| **7. Adapter Drizzle** (~1 sem) | Wrapper com RETURNING | Specs tipados (estilo `nextjs-drizzle-typed.spec.ts`) |
| **8. Operação: prune + docs + 0.x→launch** (~1 sem) | `prune()` + CLI `npx activitylog prune --days 90` (paridade com `activitylog:clean`), READMEs por pacote (tabela import/for/peer), DIVERGENCES.md, consumer-smoke | Smoke em app NestJS real; changesets release; anúncio |

Estimativa total: **8–11 semanas** de trabalho focado até um 0.x publicável com os 3 adapters. Caminho mínimo viável para validar demanda mais cedo: fases 0–4 + adapter Prisma (6) ≈ 5–6 semanas, lançar como 0.1 e medir tração antes de investir no TypeORM/Drizzle.

## 8. Mapa de paridade com o Spatie (resumo)

| Spatie | Nosso equivalente | Fase |
|---|---|---|
| `activity()->...->log()` | `activity()...log()` | 1 |
| Trait `LogsActivity` + `getActivitylogOptions()` | `@LogsActivity(options)` (TypeORM) / `prismaActivityLog(client, options)` | 5-6 |
| `logOnly/logExcept/logOnlyDirty/dontSubmitEmptyLogs/useLogName` | `LogOptions` idêntico | 5 |
| `setDescriptionForEvent(fn)` | `descriptionForEvent: (event) => string` | 5 |
| Causer resolver + `causedBy()` | `CauserResolver` via ALS + `.causedBy()` | 2 |
| `LogBatch::startBatch()` | `withBatch(fn)` | 2 |
| `activity()->withoutLogs()` / `disableLogging()` | `withoutLogging(fn)` / flags globais | 2 |
| Scopes `inLog/causedBy/forSubject/forEvent/forBatch` | Query API tipada | 3 |
| `tapActivity()` | hook `beforePersist(activity, ctx)` | 5 |
| Custom Activity model / tabela | `tableName` + `store` custom nas options | 1 |
| `activitylog:clean` | `prune()` + CLI | 8 |
| Múltiplas conexões | um `store` por `forFeature` | 4 |

**Divergências deliberadas (→ DIVERGENCES.md):** sem equivalente a eventos Eloquent globais (cada ORM tem sua costura, cobertura declarada por matriz); `properties` sempre `{ attributes, old }` mesmo em eventos custom; redaction nativa (Spatie não tem); modo outbox/async nativo (Spatie não tem).

## 9. Testes, CI e release (herdados 1:1)

Vitest 2 na raiz, aliases → src, `globals: false`, `fileParallelism: false`; SQLite `:memory:` sempre, PG/MySQL via docker-compose gated por `PG_HOST`/`MYSQL_HOST`; e2e Nest com `Test.createTestingModule`. CI inteira em Docker Compose (install → lint → typecheck → up DBs → test → build). Release via Changesets two-phase no `master` com provenance npm. Cobertura ≥85% no core como DoD.

Testes específicos deste domínio (além da paridade): rollback de transação não pode deixar atividade órfã (sync-in-tx); race de SELECT-before-update documentada com teste demonstrando o comportamento; propagação de ALS através de filas (BullMQ) documentada como limitação/receita.

## 10. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| ZenStack lançar auditoria como plugin e levar o segmento Prisma | Lançar MVP Prisma primeiro (caminho mínimo); design agnóstico dá alcance que o ZenStack não tem (TypeORM/Drizzle) |
| Cultura "faça com trigger no Postgres" | Página de docs "vs triggers" citando supa_audit arquivado, PgBouncer quebrando session vars e o post do Logfire migrando para app-level |
| Churn de majors dos ORMs (o que matou os incumbentes) | Duck-typing + peers `"*"` opcionais + lazy require (padrão já provado no metrics); CI com matriz de versões dos peers |
| Fingir diff em bulk/nested e perder confiança | Nunca fingir: evento agregado com criteria + docs explícitas da matriz de cobertura por adapter |
| Sustentabilidade solo | Escopo faseado com MVP publicável na metade; monorepo/tooling já resolvido por espelhar o metrics |

## 11. Decisões em aberto (para o ARCHITECTURE.md, estilo "grilling")

Nomes finais dos pacotes (proposta: `nestjs-activitylog-core` / `nestjs-activitylog` / `nextjs-activitylog`, espelhando o metrics; avaliar um nome de marca neutro já que o core serve Hono/Fastify); usar `nestjs-cls` como peer opcional no pacote Nest ou ALS puro em tudo (proposta: ALS puro no core, interop documentada com nestjs-cls); `bigint` vs `uuid` como PK default; JSONB vs JSON por dialeto; se o modo outbox entra no 0.x ou fica para 1.0.
