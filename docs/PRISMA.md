# Prisma adapter decisions

This document freezes the dialect, transaction, bulk and nested-write contract for the Prisma
adapter before implementation. It is the implementation brief for issue #18.

## Store and dialect

The adapter continues to use the core `SqlExecutorStore`; it does not require consumers to add an
`Activity` model to their generated Prisma Client. Prisma does not expose a stable public API for
discovering the configured provider, so adapter options use an explicit union:

```ts
type PrismaModelConfig = {
  idField?: string;                    // defaults to "id"
  relationFields?: readonly string[];  // defaults to []
};

type PrismaModelMap = Record<string, PrismaModelConfig>;

type PrismaActivityLogOptions = {
  models?: PrismaModelMap;
} & (
  | {
      dialect: 'sqlite' | 'postgres' | 'mysql';
      store?: never;
      storeTransactionMode?: never;
      tableName?: string;
    }
  | {
      store: ActivityStore;
      storeTransactionMode?: 'none' | 'uses-context';
      dialect?: never;
      tableName?: never;
    }
);
```

The concrete type also includes shared `LogOptions`. Keys in `models` are Prisma model names as
reported to a query extension (for example, `User`, not the `user` delegate property). It must
preserve the store/dialect either/or rule. Only single-field identities are supported in 0.2.
Missing or unsupported dialects and invalid model configuration fail during adapter creation,
before a mutation runs. The adapter does not inspect generated-client internals or DMMF.

For the built-in SQL store, a Prisma executor sends reads through `$queryRawUnsafe(sql, ...params)`
and mutations through `$executeRawUnsafe(sql, ...params)`. "Unsafe" refers to the API accepting a
SQL string; all values remain separate bound parameters and table names still pass through the
core identifier validator.

A custom store defaults to `storeTransactionMode: 'none'`. Setting `uses-context` is an explicit
consumer assertion that every persistence call is performed through the supplied
`TransactionRef`. `auditedTransaction` rejects a custom store without that assertion before it
opens a transaction; the best-effort extension accepts either mode. The built-in SQL store always
honours the transaction executor.

## Transaction modes

`prismaActivityLog(prisma, options)` returns a client extension and is the convenient,
best-effort mode. A query extension sees the top-level `{ model, operation, args, query }`, but its
Activity sibling is not automatically part of the mutation transaction. Update/delete old reads
also have a race window in this mode.

`auditedTransaction(prisma, options, callback)` is the iff-committed mode. It opens one Prisma
interactive transaction and passes a manual audited proxy over that exact `tx` client to the
callback. It cannot call `$extends`: Prisma transaction clients deliberately omit that method, and
client-level calls captured by a shared extension can use a new connection outside the interactive
transaction. The proxy intercepts model-delegate methods and sends every old read, mutation and
Activity write through `tx`. An exception from the callback or logging pipeline rolls all of them
back. The implementation must not capture or fall back to the root client from inside this helper.

## Individual operations

Top-level scalar-only operations produce individual Activities:

| Prisma operation | Event | Diff source |
|---|---|---|
| `create` | `created` | returned record as `attributes`, empty `old` |
| `update` | `updated` | pre-read record as `old`, returned record as `attributes` |
| `delete` | `deleted` | pre-read/returned record as `old`, empty `attributes` |
| `upsert` | `created` or `updated` | pre-read determines the branch; returned record supplies attributes |

In best-effort mode the pre-read and write are not one atomic unit, so concurrent changes can make
`old` stale. In `auditedTransaction` they share a transaction, subject to that transaction's
isolation level. The adapter uses the configured `idField` (`id` by default) for `subject_id` and
may issue private pre/post reads to obtain the complete diff without changing the caller's return
shape. If a caller supplies `select`, it must explicitly include the configured identity field; if
it supplies local `omit`, that field must not be `true`. The adapter rejects either explicit
exclusion before the mutation and uses `omit: { [idField]: false }` for its own private reads so a
global omission does not affect them. A client configured to globally omit the identity field is
not supported for audited mutations because the adapter cannot discover that configuration through
a public API while also preserving the caller's return shape. Consumers must pass a client whose
identity is globally visible; if the returned record still lacks it, the adapter fails with the
documented best-effort caveat. Compound identities remain out of scope for 0.2.

## Bulk normalization

Bulk operations never fabricate per-row old/new values. They emit one Aggregate activity:

```ts
{
  aggregate: true,
  criteria: args.where ?? {},
  changes: args.data,
  affected: result.count,
}
```

The complete mapping is:

| Operation | Event | `criteria` | `changes` | `affected` |
|---|---|---|---|---:|
| `createMany` | `created` | `{}` | `{ data, skipDuplicates? }` | `result.count` |
| `createManyAndReturn` | `created` | `{}` | `{ data, skipDuplicates? }` | returned array length |
| `updateMany` | `updated` | `where ?? {}` | `data` | `result.count` |
| `updateManyAndReturn` | `updated` | `where ?? {}` | `data` | returned array length |
| `deleteMany` | `deleted` | `where ?? {}` | `{}` | `result.count` |

Aggregate Activities use `subject_type = model` and `subject_id = null`. Before implementing the
adapter, the core Subject type, SQL value mapping and row mapper must preserve a typed Subject with
a null id; the current `SubjectRef | null` representation would otherwise lose `subject_type`.

## Nested-write normalization

A nested write is recorded as one Aggregate activity for the top-level model/operation. It is not
decomposed by relation and does not also produce an individual parent Activity. Its properties are:

```ts
{
  aggregate: true,
  criteria: args.where ?? {},
  changes: args.data,
  affected: 1,
}
```

For a top-level `upsert`, `changes` is `{ create: args.create, update: args.update }`; Prisma does
not expose those branches under `args.data`. Operation semantics live in `Activity.event`, keeping
the aggregate envelope exactly aligned with D9.

Nested syntax is recognized only under fields explicitly listed in that model's `relationFields`.
Those fields are inspected for relation operations (`create`, `createMany`, `connect`,
`connectOrCreate`, `disconnect`, `delete`, `deleteMany`, `set`, `update`, `updateMany`, `upsert`).
Unlisted fields are scalar for detection purposes, including scalar and scalar-list `{ set: ... }`
operations. A model with no configured relation fields therefore has no automatic nested-write
detection. This public, deterministic contract avoids guessing from JSON contents or undocumented
runtime metadata.

Database-level referential cascades are not nested operations visible to the client extension and
remain outside automatic coverage. Applications that require them in the trail must emit an
explicit Aggregate/manual Activity.

## Portable value normalization

Before values enter `DiffEngine` or aggregate properties, the adapter creates an audit-only copy
with this recursive normalization (the original Prisma arguments and result are never mutated):

| Input | Audit representation |
|---|---|
| `bigint` | base-10 string |
| `Date` | ISO-8601 UTC string |
| Prisma `Decimal` | canonical decimal string |
| `Uint8Array`/Node `Buffer` | `{ "$bytes": "<base64>" }` |
| Prisma `DbNull`, `JsonNull`, `AnyNull` | `{ "$prismaNull": "DbNull" | "JsonNull" | "AnyNull" }` |
| array | recursively normalized; `undefined` slots become `null` |
| plain object | recursively normalized; `undefined` properties are omitted |

Finite numbers, strings, booleans and `null` are preserved. Cycles, non-finite numbers,
functions, symbols and unsupported class instances fail with an `activitylog:`-prefixed error
that identifies the Prisma adapter instead of being stringified ambiguously. Input arguments are
validated before mutation; returned database values are normalized before Activity persistence.
In best-effort mode a post-mutation normalization/persistence failure cannot undo the mutation,
which is part of that mode's documented limitation; in `auditedTransaction` it rolls the
transaction back.

References: [Prisma query extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions/query),
[Prisma transactions and nested writes](https://www.prisma.io/docs/orm/prisma-client/queries/transactions),
[Prisma CRUD bulk results](https://www.prisma.io/docs/orm/prisma-client/queries/crud),
[Prisma shared extension transaction limitation](https://docs.prisma.io/docs/orm/prisma-client/client-extensions/shared-extensions).
