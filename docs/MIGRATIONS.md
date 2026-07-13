# Activity Log Schema References

`activitylog-core` exports `ACTIVITY_LOG_MIGRATIONS` for PostgreSQL, MySQL and SQLite. The
library does not execute these migrations; apply the matching SQL through the application's
migration system.

```ts
import { ACTIVITY_LOG_MIGRATIONS } from 'activitylog-core';

await database.execute(ACTIVITY_LOG_MIGRATIONS.postgres);
```

All variants contain `log_name`, subject and causer composite indexes, JSON-compatible
`properties`, and an application-generated `created_at`. Store timestamps in UTC and order
activity lists by `created_at, id`.

## TypeORM reference

```ts
@Entity({ name: 'activity_log' })
export class ActivityLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: string;
  @Column({ name: 'log_name' }) logName!: string;
  @Column('text') description!: string;
  @Column({ name: 'subject_type', nullable: true }) subjectType!: string | null;
  @Column({ name: 'subject_id', nullable: true }) subjectId!: string | null;
  @Column({ name: 'causer_type', nullable: true }) causerType!: string | null;
  @Column({ name: 'causer_id', nullable: true }) causerId!: string | null;
  @Column({ nullable: true }) event!: string | null;
  @Column({ type: 'jsonb' }) properties!: Record<string, unknown>;
  @Column({ name: 'batch_uuid', nullable: true }) batchUuid!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 }) createdAt!: Date;
}
```

Use the dialect-equivalent JSON and timestamp types when the TypeORM datasource is MySQL or
SQLite. The future TypeORM adapter will expose this integration from `activitylog-nestjs`.

## Prisma reference

```prisma
model ActivityLog {
  id          BigInt   @id @default(autoincrement())
  logName     String   @map("log_name")
  description String
  subjectType String?  @map("subject_type")
  subjectId   String?  @map("subject_id")
  causerType  String?  @map("causer_type")
  causerId    String?  @map("causer_id")
  event       String?
  properties  Json
  batchUuid   String?  @map("batch_uuid")
  createdAt   DateTime @map("created_at") @db.Timestamptz(3)

  @@index([logName])
  @@index([subjectType, subjectId])
  @@index([causerType, causerId])
  @@map("activity_log")
}
```

For MySQL use Prisma's matching `DateTime` native type; SQLite uses its standard `DateTime`
mapping. The future Prisma adapter will live under `activitylog-nextjs/prisma`.

## Drizzle reference

```ts
export const activityLog = pgTable('activity_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  logName: varchar('log_name', { length: 255 }).notNull(),
  description: text('description').notNull(),
  subjectType: varchar('subject_type', { length: 255 }),
  subjectId: varchar('subject_id', { length: 255 }),
  causerType: varchar('causer_type', { length: 255 }),
  causerId: varchar('causer_id', { length: 255 }),
  event: varchar('event', { length: 255 }),
  properties: jsonb('properties').notNull(),
  batchUuid: varchar('batch_uuid', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull(),
}, (table) => [
  index('idx_activity_log_log_name').on(table.logName),
  index('idx_activity_log_subject').on(table.subjectType, table.subjectId),
  index('idx_activity_log_causer').on(table.causerType, table.causerId),
]);
```

The future Drizzle adapter will live under `activitylog-nextjs/drizzle`.
