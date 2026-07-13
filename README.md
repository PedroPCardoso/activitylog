# activitylog

ORM-agnostic entity audit trail for TypeScript, with the DX of
[spatie/laravel-activitylog](https://github.com/spatie/laravel-activitylog). The core knows
nothing about any ORM or about NestJS; adapters are first-class.

> **Status:** early development. The core now supports manual logging through a SQL executor;
> framework adapters, automatic diffs, context causer resolution and the fluent query API are
> still being delivered in later tickets.

## The bet

- **ORM-agnostic core + first-class adapters** — TypeORM, Prisma, Drizzle.
- **`iff-committed`** — an activity persists *if and only if* the mutation that caused it
  commits (when transactional). The audit trail never orphans or drops a record.
- **Causer resolved automatically** from request context (AsyncLocalStorage).
- **Honest coverage** — where a guarantee isn't possible (e.g. bulk/nested writes), it's
  declared in a coverage matrix, never faked.
- **Redaction on by default** — passwords, tokens and PII don't leak into the audit trail.

## Planned packages

| Package | Contents |
|---|---|
| `activitylog-core` | Agnostic core: logger, store, diff, context, query API |
| `activitylog-nestjs` | NestJS module + TypeORM adapter (subpath) |
| `activitylog-nextjs` | Prisma + Drizzle adapters (subpaths) |

## Manual logging

`activitylog-core` accepts an executor supplied by your database client or ORM. It does not
load a database driver itself, so the same store works behind an ORM transaction and preserves
the transaction boundary.

```ts
import {
  SqlExecutorStore,
  createActivityLogger,
  causerRef,
  subjectRef,
} from 'activitylog-core';

const store = new SqlExecutorStore({
  dataSource: {
    dialect: 'postgres',
    execute: async (sql, params) => pool.query(sql, params).then((result) => result.rows),
  },
});

const logger = createActivityLogger({ store });

await logger
  .activity('billing')
  .performedOn(subjectRef('Order', order.id))
  .causedBy(causerRef('User', userId))
  .withProperties({ plan: 'pro' })
  .event('subscribed')
  .log('Subscription created');
```

`createdAt` defaults to the application clock in UTC with millisecond precision. Call
`.createdAt(date)` to supply the logical event time. `.on()`/`.by()` are aliases for
`.performedOn()`/`.causedBy()`, and `.byAnonymous()` removes an explicit causer.

`logOptions` redact nested sensitive property names before persistence. The default list includes
passwords, tokens, secrets, authorization data and email addresses; pass a replacement list or
`redact: false` only when that policy is explicitly appropriate for the application. A
`beforePersist` hook can enrich an activity, but its output is redacted as well.

Pass an executor bound to an existing ORM transaction as the second `persist` argument when
writing directly to a store. The core never commits or rolls back a transaction itself.

## Context and batches

Use `runWithContext` around a request or job to supply a causer. It flows through promises and
timers, and the logger uses it only when `.causedBy()` was omitted. `withBatch` assigns one UUID
to a unit of work and nested calls reuse that UUID. For a queue boundary, pass
`serializeContext()` with the job payload and restore it with `runWithContext()` in the worker.
`withoutLogging`, `disableLogging`, and `enableLogging` provide explicit suppression controls.

## Schema

`ACTIVITY_LOG_MIGRATIONS` exports reference SQL for `sqlite`, `postgres`, and `mysql`. The
migrations use an application-supplied UTC timestamp: ISO text in SQLite, `timestamptz(3)` in
PostgreSQL, and UTC `datetime(3)` in MySQL. See [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) for
the SQL and ORM schema references.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — execution plan
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — locked decisions (D1–D17)
- [`CONTEXT.md`](CONTEXT.md) — domain glossary + the `iff-committed` invariant
- [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md) — roadmap
- [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) — schema references by dialect and ORM

## License

[MIT](LICENSE)
