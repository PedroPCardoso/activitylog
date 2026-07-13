# TypeORM adapter

The `activitylog-nestjs/typeorm` subpath audits entity lifecycle operations through a TypeORM
subscriber. Decorate only the entities whose changes should be logged:

```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { LogsActivity } from 'activitylog-nestjs/typeorm';

@LogsActivity({
  logOnly: ['name', 'status'],
  logOnlyDirty: true,
})
@Entity()
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  status!: string;
}
```

After the TypeORM `DataSource` is initialized, register one subscriber. The store may be the same
one supplied to `ActivityLogModule`:

```ts
import { registerActivityLogSubscriber } from 'activitylog-nestjs/typeorm';

await dataSource.initialize();
registerActivityLogSubscriber(dataSource, { store });
```

Registration happens after initialization because TypeORM rebuilds its configured subscriber
list while initializing. Nest applications can perform this step from a provider's
`onModuleInit()` after injecting the initialized `DataSource` and the application's store. The
registration also makes that store and its defaults available to the three-argument
`auditedUpdate()` helper. `ActivityLogSubscriber` remains exported for advanced manual
registration, but a manually pushed instance cannot provide configuration to `auditedUpdate()`.

## Diffs and options

`repository.save()` creates `created` or `updated` Activities. `repository.remove()` and
`repository.softRemove()` create `deleted` Activities. Each activity uses the entity class name
as `subject.type`, the single primary-column value as `subject.id`, and keeps the diff in:

```ts
{
  attributes: { status: 'paid' },
  old: { status: 'pending' },
}
```

Created Activities have an empty `old`; hard-deleted Activities have empty `attributes`.
Soft-delete diffs contain the changed delete-date column. Composite primary keys are outside the
0.x contract and are skipped rather than recorded with an ambiguous identity.

Entity options apply `logOnly`, `logExcept`, and `logOnlyDirty` before the core pipeline. The
subscriber then delegates to the core logger, preserving `descriptionForEvent`, `beforePersist`,
redaction, `dontSubmitEmptyLogs`, request/job causer, and batch behavior. Subscriber defaults can
be supplied through `registerActivityLogSubscriber(dataSource, { store, logOptions })`; entity
decorator options take precedence over those defaults.

## auditedUpdate

TypeORM does not provide a reliable old entity to subscribers for `Repository.update()` or
update QueryBuilder calls. Use the explicit helper for a single-row criteria update:

```ts
import { auditedUpdate } from 'activitylog-nestjs/typeorm';

await auditedUpdate(
  dataSource.getRepository(Order),
  { id: orderId },
  { status: 'paid' },
);
```

The helper opens or nests a transaction, reads the matching row, performs the update, re-reads it
by primary key, calculates the diff and persists the Activity before committing. A fourth
`LogOptions` argument can override registration and decorator defaults for that call.

No match returns an `UpdateResult` with `affected: 0` and does not create an Activity. Criteria
matching more than one row are rejected before mutation: expanding bulk changes into per-row
Activities would violate the aggregate-activity contract. Composite primary keys are likewise
outside the 0.x contract. Use `lockForDiff: true` when the database supports pessimistic write
locks and exact old values under concurrent writers justify the contention cost.

## Transaction boundary and coverage

The lifecycle subscriber writes through the `manager` supplied on the TypeORM event. This keeps
an emitted Activity in the event's live transaction, but the subscriber remains a convenience:
TypeORM can omit the entity or old state for some update, cascade and bulk paths. `auditedUpdate`
is the explicit iff-committed path because it owns the complete read/mutate/re-read/write unit.
This follows TypeORM's requirement that subscriber database work use the event's manager or query
runner.

| TypeORM operation | Automatic subscriber | Supported path | Guarantee and limitation |
|---|---:|---|---|
| `save()` insert | ✅ | `@LogsActivity()` + subscriber | Activity uses event manager when TypeORM supplies the entity |
| `save()` update | ✅ | `@LogsActivity()` + subscriber | Old/new diff for full and partial saves; event payload still defines coverage |
| `remove()` | ✅ | `@LogsActivity()` + subscriber | Logged when TypeORM supplies `databaseEntity`; entity-less cascades are skipped |
| `softRemove()` | ✅ | `@LogsActivity()` + subscriber | Delete-date diff when entity and old state are supplied |
| `repository.update()` | ⚠️ | `auditedUpdate()` | Direct call is intentionally not logged; helper guarantees one-row iff-committed |
| update QueryBuilder | ⚠️ | `auditedUpdate()` | Direct QueryBuilder is intentionally not logged; express its criteria/patch through helper |
| bulk update | ❌ | explicit Aggregate activity | Per-row expansion is not fabricated; aggregate helper is not part of 0.1 |
| entity-less cascade | ❌ | explicit/manual activity | No reliable subject or old state; subscriber skips it |

References: [TypeORM listeners and subscribers](https://typeorm.io/docs/advanced-topics/listeners-and-subscribers/),
[TypeORM transactions](https://typeorm.io/docs/transactions/).
