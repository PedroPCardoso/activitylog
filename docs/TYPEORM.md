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

After the TypeORM `DataSource` is initialized, register one subscriber instance. The store may
be the same one supplied to `ActivityLogModule`:

```ts
import { ActivityLogSubscriber } from 'activitylog-nestjs/typeorm';

await dataSource.initialize();
dataSource.subscribers.push(new ActivityLogSubscriber({ store }));
```

Registration happens after initialization because TypeORM rebuilds its configured subscriber
list while initializing. Nest applications can perform this step from a provider's
`onModuleInit()` after injecting the initialized `DataSource` and the application's store.

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
be supplied through `new ActivityLogSubscriber({ store, logOptions })`; entity decorator options
take precedence over those defaults.

## Transaction boundary

The subscriber writes through the `manager` supplied on the TypeORM event. Therefore, when the
mutation is inside a transaction, its Activity insert uses that same live transaction and rolls
back with the mutation. This follows TypeORM's requirement that subscriber database work use the
event's manager or query runner.

The subscriber intentionally does not claim complete coverage for `repository.update()`, update
QueryBuilder calls, bulk operations, cascades without an entity payload, or events without an old
database entity. TypeORM does not provide enough reliable entity state in those paths. Issue #16
adds the explicit `auditedUpdate()` path and the complete coverage matrix.

References: [TypeORM listeners and subscribers](https://typeorm.io/docs/advanced-topics/listeners-and-subscribers/),
[TypeORM transactions](https://typeorm.io/docs/transactions/).
