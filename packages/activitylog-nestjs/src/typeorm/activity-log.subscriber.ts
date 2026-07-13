import {
  ActivityLogger,
  mergeLogOptions,
  resolveLogOptions,
  subjectRef,
  type ActivityEvent,
  type ActivityId,
  type ActivityStore,
  type LogOptions,
  type NewActivity,
  type SqlRow,
  type TransactionRef,
} from 'activitylog-core';
import type {
  EntityManager,
  EntityMetadata,
  EntitySubscriberInterface,
  InsertEvent,
  ObjectLiteral,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';

import { DiffEngine } from './diff-engine';
import { getLogsActivityOptions } from './logs-activity.decorator';

export interface ActivityLogSubscriberOptions {
  store: ActivityStore;
  logOptions?: LogOptions;
  now?: () => Date;
}

export class ActivityLogSubscriber implements EntitySubscriberInterface<ObjectLiteral> {
  constructor(private readonly options: ActivityLogSubscriberOptions) {}

  async afterInsert(event: InsertEvent<ObjectLiteral>): Promise<void> {
    await this.record(event, 'created', {}, snapshot(event.metadata, event.entity), event.entity);
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    if (event.entity === undefined || event.databaseEntity === undefined) {
      return;
    }

    const old = snapshot(event.metadata, event.databaseEntity);
    const dirty = event.updatedColumns.map((column) => column.propertyPath);

    await this.record(
      event,
      'updated',
      old,
      overlaySnapshot(old, snapshot(event.metadata, event.entity), dirty),
      event.entity,
      dirty,
    );
  }

  async afterRemove(event: RemoveEvent<ObjectLiteral>): Promise<void> {
    if (event.databaseEntity === undefined) {
      return;
    }

    await this.record(event, 'deleted', snapshot(event.metadata, event.databaseEntity), {}, event.databaseEntity);
  }

  async afterSoftRemove(event: SoftRemoveEvent<ObjectLiteral>): Promise<void> {
    if (event.entity === undefined || event.databaseEntity === undefined) {
      return;
    }

    const old = snapshot(event.metadata, event.databaseEntity);

    await this.record(
      event,
      'deleted',
      old,
      overlayDefinedSnapshot(old, snapshot(event.metadata, event.entity)),
      event.entity,
    );
  }

  private async record(
    event: SubscriberEvent,
    activityEvent: ActivityEvent,
    old: Record<string, unknown>,
    attributes: Record<string, unknown>,
    entity: ObjectLiteral,
    dirty?: readonly string[],
  ): Promise<void> {
    const entityOptions = getLogsActivityOptions(event.metadata.target);
    if (entityOptions === undefined) {
      return;
    }

    const id = entityId(event.metadata, entity);
    if (id === undefined) {
      return;
    }

    const mergedOptions = mergeLogOptions(this.options.logOptions, entityOptions);
    const resolvedOptions = resolveLogOptions(mergedOptions);
    const diff = DiffEngine.diff({ old, attributes, dirty, options: resolvedOptions });
    const subject = subjectRef(event.metadata.targetName, id);
    const description = resolvedOptions.descriptionForEvent?.({
      event: activityEvent,
      subject,
      diff,
    }) ?? `${event.metadata.targetName} ${activityEvent}`;
    const store = resolvedOptions.store ?? this.options.store;
    const logger = new ActivityLogger({
      store: transactionStore(store, event.manager),
      now: this.options.now,
      logOptions: mergedOptions,
    });

    await logger
      .activity(resolvedOptions.useLogName)
      .performedOn(subject)
      .event(activityEvent)
      .withProperties({ attributes: diff.attributes, old: diff.old })
      .log(description);
  }
}

type SubscriberEvent = Pick<InsertEvent<ObjectLiteral>, 'manager' | 'metadata'>;

function snapshot(metadata: EntityMetadata, entity: ObjectLiteral): Record<string, unknown> {
  return Object.fromEntries(
    metadata.columns
      .filter((column) => !column.isVirtual)
      .map((column) => [column.propertyPath, column.getEntityValue(entity)]),
  );
}

function overlaySnapshot(
  base: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  paths: readonly string[],
): Record<string, unknown> {
  const result = { ...base };

  for (const path of paths) {
    result[path] = patch[path];
  }

  return result;
}

function overlayDefinedSnapshot(
  base: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result = { ...base };

  for (const [path, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[path] = value;
    }
  }

  return result;
}

function entityId(metadata: EntityMetadata, entity: ObjectLiteral): ActivityId | undefined {
  if (metadata.hasMultiplePrimaryKeys) {
    return undefined;
  }

  const value = metadata.primaryColumns[0]?.getEntityValue(entity);
  return isActivityId(value) ? value : undefined;
}

function isActivityId(value: unknown): value is ActivityId {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint';
}

function transactionStore(store: ActivityStore, manager: EntityManager): ActivityStore {
  const transaction: TransactionRef = {
    execute: async (sql, params = []) => normalizeRows(await manager.query(sql, [...params])),
  };

  return {
    persist: async (activities: readonly NewActivity[]) => store.persist(activities, transaction),
    query: (filter) => store.query(filter),
    prune: (olderThan, logName) => store.prune(olderThan, logName),
  };
}

function normalizeRows(value: unknown): readonly SqlRow[] {
  return Array.isArray(value) ? value as SqlRow[] : [];
}
