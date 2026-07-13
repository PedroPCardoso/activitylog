# Deliberate divergences from Spatie Activitylog

Spatie's Laravel package is the functional inspiration, not a promise that TypeScript ORMs expose
the same lifecycle hooks as Eloquent. These differences are deliberate and part of the public
contract.

## ORM event coverage is explicit

Eloquent can observe model lifecycle events with rich original/current state. TypeORM and Prisma
do not expose equivalent state for every write shape. Activitylog therefore publishes an adapter
coverage matrix instead of claiming that one global hook sees everything.

For TypeORM, decorated `save`, `remove`, and `softRemove` lifecycle events are subscriber
conveniences. Direct `Repository.update()` and update QueryBuilder calls are not treated as if
they had a trustworthy old entity; `auditedUpdate()` is the explicit single-row, iff-committed
alternative. Bulk writes require one Aggregate activity rather than an invented per-row diff.
See [`docs/TYPEORM.md`](docs/TYPEORM.md) for the operation-by-operation matrix.

## Properties always use a stable diff envelope

Automatic entity changes store `properties.attributes` and `properties.old`. Creates have an
empty `old`; hard deletes have empty `attributes`. This predictable envelope is used across ORM
adapters instead of copying framework-specific change representations.

## Redaction is built in and enabled by default

Sensitive field names are deeply redacted before persistence. A `beforePersist` hook may enrich
an Activity, but redaction runs afterward and remains the final guard. Disabling or replacing the
default deny list must be explicit.

## Identity is ORM-agnostic

Subjects and causers use an opaque type plus a string-compatible single primary key. Composite
subject keys are outside the 0.x contract. This avoids coupling the core to ORM model instances
or database-specific key types.

## Transactions are claimed only where they are controlled

The core accepts a transaction-bound executor but never starts or commits transactions itself.
Adapters claim iff-committed only on explicit paths that control the entire mutation and Activity
write, such as TypeORM `auditedUpdate()`. Convenience hooks remain documented with their payload
and coverage limitations.
