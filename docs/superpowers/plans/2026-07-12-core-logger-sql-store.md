# Core Logger and SQL Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide manual activity logging backed by a dialect-aware SQL store, with real SQLite/PostgreSQL/MySQL verification and reference migrations.

**Architecture:** `ActivityLogger` owns immutable fluent builders and delegates persistence to the existing `ActivityStore` boundary. `SqlExecutorStore` owns only SQL serialization, validation and row mapping; it receives an ORM-agnostic executor and uses an optional transaction executor for writes. Dialect classes own positional placeholders and identifier quoting.

**Tech Stack:** TypeScript 5, Vitest 4, tsup, `better-sqlite3` for development-only SQLite integration tests, PostgreSQL 16/MySQL 8 through the existing OrbStack Docker Compose services.

## Global Constraints

- Runtime package remains CJS-only, Node `>=18`, and does not depend on an ORM or a database driver.
- `created_at` is application-generated UTC ISO-8601 with millisecond precision; list ordering is `created_at, id`.
- Values are positional bound parameters; interpolated identifiers must be validated by `assertSafeIdentifier` and quoted per dialect.
- Public exception messages begin with `activitylog:` and extend native `Error`.
- The `ActivityStore.persist(activities, ctx?)` signature remains `Promise<void>`.
- SQLite is mandatory; PostgreSQL/MySQL execute only when `PG_HOST`/`MYSQL_HOST` are set.

---

### Task 1: SQL contracts, validation and exceptions

**Files:**
- Create: `packages/core/src/sql/datasource.types.ts`
- Create: `packages/core/src/sql/sql-dialect.ts`
- Create: `packages/core/src/sql/validation.ts`
- Create: `packages/core/src/exceptions/activitylog.exception.ts`
- Create: `packages/core/src/exceptions/invalid-identifier.exception.ts`
- Create: `packages/core/src/exceptions/invalid-activity-date.exception.ts`
- Create: `packages/core/src/exceptions/unsupported-filter.exception.ts`
- Modify: `packages/core/src/types/store.types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `test/sql-contracts.spec.ts`

**Consumes:** Existing `TransactionRef` and `ActivityFilter` contracts.

**Produces:** `SqlDataSource`, `SupportedDialect`, `SqlDialect`, `dialectFor`, `assertSafeIdentifier` and public exception classes.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { InvalidIdentifierException, assertSafeIdentifier, dialectFor } from 'activitylog-core';

it('quotes identifiers and creates placeholders for every dialect', () => {
  expect(dialectFor('postgres').placeholder(2)).toBe('$2');
  expect(dialectFor('mysql').escapeIdentifier('activity_log')).toBe('`activity_log`');
  expect(dialectFor('sqlite').escapeIdentifier('activity_log')).toBe('"activity_log"');
});

it('rejects unsafe identifiers with the public error prefix', () => {
  expect(() => assertSafeIdentifier('activity_log; DROP TABLE users')).toThrow(InvalidIdentifierException);
  expect(() => assertSafeIdentifier('activity_log; DROP TABLE users')).toThrow(/^activitylog:/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/sql-contracts.spec.ts`

Expected: FAIL because the public SQL exports do not exist.

- [ ] **Step 3: Implement the minimal contracts**

```ts
export type SupportedDialect = 'sqlite' | 'postgres' | 'mysql';

export interface SqlDataSource {
  dialect: SupportedDialect;
  execute(sql: string, params?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface SqlDialect {
  placeholder(index: number): string;
  escapeIdentifier(identifier: string): string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;
export function assertSafeIdentifier(identifier: string): void {
  if (!IDENTIFIER.test(identifier)) throw new InvalidIdentifierException(identifier);
}
```

Create `ActivityLogException` with `super(\`activitylog: ${message}\`)`, have each public error extend it, and export the types/functions through `index.ts`. Keep `TransactionRef` structurally compatible with `SqlDataSource['execute']`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/sql-contracts.spec.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src test/sql-contracts.spec.ts
git commit -m "feat(core): add SQL dialect contracts"
```

### Task 2: Fluent manual logger

**Files:**
- Create: `packages/core/src/logger/activity-logger.ts`
- Modify: `packages/core/src/index.ts`
- Test: `test/logger.spec.ts`

**Consumes:** `ActivityStore`, `NewActivity`, `createActivityTimestamp`, refs and `ActivityLogContext`.

**Produces:** `createActivityLogger`, `ActivityLogger`, `ActivityLogBuilder` and the fluent manual API.

- [ ] **Step 1: Write the failing SQLite-independent logger tests using an observing store**

```ts
const persisted: NewActivity[] = [];
const store: ActivityStore = { persist: async (items) => void persisted.push(...items), query: async () => [], prune: async () => 0 };
const logger = createActivityLogger({ store, now: () => new Date('2026-07-12T10:20:30.123Z') });

it('builds an activity through the manual Spatie-style chain', async () => {
  await logger.activity('billing').performedOn(subjectRef('Order', 12)).causedBy(causerRef('User', 'u1'))
    .withProperties({ plan: 'pro' }).event('subscribed').log('Subscription created');
  expect(persisted).toEqual([expect.objectContaining({ logName: 'billing', description: 'Subscription created', createdAt: new Date('2026-07-12T10:20:30.123Z') })]);
});
```

Add isolated tests for aliases (`on`, `by`, `byAnonymous`), custom `createdAt`, `event`, merged properties and `tap` mutating `properties`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/logger.spec.ts`

Expected: FAIL because `createActivityLogger` does not exist.

- [ ] **Step 3: Implement the immutable builder**

```ts
export interface ActivityLoggerOptions { store: ActivityStore; logName?: string; now?: () => Date; }
export function createActivityLogger(options: ActivityLoggerOptions): ActivityLogger {
  return new ActivityLogger(options);
}

export class ActivityLogger {
  activity(logName = this.defaultLogName): ActivityLogBuilder {
    return new ActivityLogBuilder(this.options.store, this.options.now ?? (() => new Date()), { logName });
  }
}

export class ActivityLogBuilder {
  performedOn(subject: SubjectRef): ActivityLogBuilder { return this.copy({ subject }); }
  on(subject: SubjectRef): ActivityLogBuilder { return this.performedOn(subject); }
  async log(description: string): Promise<void> {
    await this.store.persist([{ ...this.state, description, createdAt: this.timestamp() }]);
  }
}
```

Use `createActivityTimestamp(this.now())` unless `createdAt` was explicitly supplied; reject invalid dates with `InvalidActivityDateException`. Clone supplied dates/properties so later caller mutation cannot alter the persisted item. Use the current ALS `batchUuid` but do not add causer resolution in this task.

- [ ] **Step 4: Run logger tests to verify they pass**

Run: `npm test -- test/logger.spec.ts`

Expected: PASS for each manual builder behavior.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/logger packages/core/src/index.ts test/logger.spec.ts
git commit -m "feat(core): add fluent manual activity logger"
```

### Task 3: SQL store and real SQLite integration

**Files:**
- Create: `packages/core/src/store/sql-executor.store.ts`
- Create: `packages/core/src/store/activity-row.mapper.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/helpers/sqlite-executor.ts`
- Modify: `test/logger.spec.ts`
- Test: `test/sql-executor-store.spec.ts`

**Consumes:** Task 1 data source/dialects/validation and Task 2 logger.

**Produces:** `SqlExecutorStore`, real `:memory:` behavior and transaction-executor selection.

- [ ] **Step 1: Write the failing real SQLite test**

```ts
it('persists and reads manual activities from SQLite memory', async () => {
  const sqlite = createSqliteExecutor();
  await createSqliteSchema(sqlite.database);
  const store = new SqlExecutorStore({ dataSource: sqlite.dataSource });
  await createActivityLogger({ store }).activity('billing').withProperties({ plan: 'pro' }).log('created');
  await expect(store.query({ logName: 'billing' })).resolves.toEqual([
    expect.objectContaining({ description: 'created', properties: { plan: 'pro' } }),
  ]);
});
```

Also write tests that capture prepared SQL for every dialect, prove `tableName` injection is rejected before `execute`, prove `persist(..., transaction)` uses the transaction executor, and prove `prune` deletes only the requested age/log.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/sql-executor-store.spec.ts`

Expected: FAIL because `SqlExecutorStore` does not exist.

- [ ] **Step 3: Add the development-only driver and implement the store**

Run: `npm install --save-dev better-sqlite3 @types/better-sqlite3`

```ts
export class SqlExecutorStore implements ActivityStore {
  constructor(private readonly options: { dataSource: SqlDataSource; tableName?: string }) {}
  async persist(activities: readonly NewActivity[], ctx?: TransactionRef): Promise<void> {
    const executor = ctx ?? this.options.dataSource;
    for (const activity of activities) await executor.execute(this.insertSql(), this.insertParams(activity));
  }
  async query(filter: ActivityFilter): Promise<readonly Activity[]> {
    const { sql, params } = this.selectStatement(filter);
    return (await this.options.dataSource.execute(sql, params)).map(mapActivityRow);
  }
  async prune(olderThan: Date, logName?: string): Promise<number> {
    return affectedRows(await this.options.dataSource.execute(this.pruneSql(logName), this.pruneParams(olderThan, logName)));
  }
}
```

Generate `INSERT` and structured `SELECT` with the dialect placeholder strategy. Encode `id`/entity IDs as strings, JSON stringify properties, and store `createdAt.toISOString()`. Map all result variants back to `Activity`, including string/date timestamps and `properties` returned as JSON object or JSON string. Reject `filter.properties` and `filter.cursor` with `UnsupportedActivityFilterException`; apply `created_at, id` order.

`test/helpers/sqlite-executor.ts` wraps `better-sqlite3` so that `.run()` returns an array with `{ affectedRows, lastInsertRowid }` and `.all()` returns rows. Never import that helper from package source.

- [ ] **Step 4: Run SQLite and structural SQL tests to verify they pass**

Run: `npm test -- test/logger.spec.ts test/sql-executor-store.spec.ts`

Expected: PASS, including a real `:memory:` write/read cycle.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/core/src/store packages/core/src/index.ts test
git commit -m "feat(core): persist activities through SQL executors"
```

### Task 4: Reference migrations and external-dialect matrix

**Files:**
- Create: `packages/core/src/migrations/activity-log.migrations.ts`
- Modify: `packages/core/src/index.ts`
- Create: `test/helpers/external-sql-executors.ts`
- Create: `test/sql-dialects.integration.spec.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsup.config.ts`

**Consumes:** `SqlExecutorStore`, `SupportedDialect`, and the schema column mapping from Task 3.

**Produces:** exported reference migration SQL for all three dialects and gated real PostgreSQL/MySQL integration.

- [ ] **Step 1: Write failing migration and gated-matrix tests**

```ts
it('publishes migrations with all required columns and indexes', () => {
  for (const dialect of ['sqlite', 'postgres', 'mysql'] as const) {
    expect(ACTIVITY_LOG_MIGRATIONS[dialect]).toContain('created_at');
    expect(ACTIVITY_LOG_MIGRATIONS[dialect]).toContain('subject_type');
  }
});

for (const source of availableExternalDataSources()) {
  it(`persists the manual logger example in ${source.dialect}`, async () => {
    await source.execute(ACTIVITY_LOG_MIGRATIONS[source.dialect]);
    const store = new SqlExecutorStore({ dataSource: source });
    await createActivityLogger({ store }).activity('billing').event('created').log('created');
    expect(await store.query({ logName: 'billing' })).toHaveLength(1);
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/sql-dialects.integration.spec.ts`

Expected: FAIL because migrations and external executor helpers do not exist; with no env, the external cases are skipped.

- [ ] **Step 3: Implement migrations and executor helpers**

Export `ACTIVITY_LOG_MIGRATIONS` as an object of idempotent reference SQL strings. Include `log_name`, subject and causer indexes. Export it through the root entrypoint so it is included in the CJS bundle; do not make ORM packages runtime dependencies. The external helper uses dynamic `pg`/`mysql2` imports, reads the existing Compose environment variables, converts `$n`/`?` parameters through the native clients, and closes clients in `afterAll`.

Add `pg`, `mysql2` and their typings as root development dependencies. Keep test enumeration empty when its host variable is absent.

- [ ] **Step 4: Run the matrix with Docker services to verify it passes**

Run: `docker-compose up -d postgres mysql && docker-compose run --rm -e PG_HOST=postgres -e MYSQL_HOST=mysql dev npm test -- test/sql-dialects.integration.spec.ts`

Expected: PASS for SQLite, PostgreSQL and MySQL, then run `docker-compose down -v`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages/core/src/migrations packages/core/src/index.ts test
git commit -m "feat(core): add activity log migrations and SQL matrix"
```

### Task 5: Documentation, full verification and PR update

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `.changeset/initial-bootstrap.md` or create a focused changeset
- Modify: `docs/superpowers/plans/2026-07-12-core-logger-sql-store.md`

**Consumes:** Completed public core API and migration exports.

**Produces:** usage documentation, release metadata and verified PR #20 update.

- [ ] **Step 1: Write the documentation smoke test first**

Add the README manual snippet verbatim to `test/logger.spec.ts`, replacing only concrete store setup with the SQLite helper. The assertion must query the stored activity and compare description, subject, causer, event, properties and ISO timestamp.

- [ ] **Step 2: Run the documentation smoke test to verify the documented API**

Run: `npm test -- test/logger.spec.ts`

Expected: PASS only when the documented public API exactly matches the implementation; correct the snippet or implementation if it does not.

- [ ] **Step 3: Document public use and limits**

Document `createActivityLogger`, `SqlExecutorStore`, transaction executor passing, reference migrations, UTC timestamp semantics and the deferred Query API/JSON filters. Add a patch changeset for `activitylog-core` covering the manual logger and SQL store.

- [ ] **Step 4: Run complete local and OrbStack verification**

Run:

```bash
npm install
npm audit
npm run lint
npm run typecheck
npm test
npm run build
npx changeset status --verbose
npm publish --dry-run --workspaces
docker-compose build dev
docker-compose run --rm dev npm ci
docker-compose run --rm dev npm audit
docker-compose run --rm dev npm run lint
docker-compose run --rm dev npm run typecheck
docker-compose run --rm dev npm test
docker-compose run --rm dev npm run build
docker-compose down -v
```

Expected: every command exits `0`; audit reports zero vulnerabilities; test and build outputs report no failures.

- [ ] **Step 5: Review, commit, push and update PR #20**

Run:

```bash
git diff --check origin/main...
git diff --stat origin/main...
git status --short
git add README.md docs .changeset test packages package.json package-lock.json
git commit -m "docs: document core activity logging"
git push origin executar-onda-prs
gh pr edit 20 --add-body "\n\nCloses #9"
gh pr checks 20 --watch
```

Expected: clean diff check, a pushed branch, #9 linked as closing and all GitHub checks passing.

## Plan Review

- Spec coverage: Tasks 1-4 implement the core boundary, manual fluent logger, all SQL dialects, migrations, error contract, transaction seam, security and test matrix; Task 5 covers docs, release and PR verification.
- No placeholders: all interfaces, test names, commands and files are explicit. Query API fluent/cursor/JSON remains intentionally deferred to #13 and is guarded by an explicit capability error.
- Type consistency: `SqlDataSource` supplies dialect plus execute; `TransactionRef` remains an execute-only override; all writes return `Promise<void>` through the existing `ActivityStore` contract.
