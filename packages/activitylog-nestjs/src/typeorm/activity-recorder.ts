import {
  ActivityLogger,
  DiffEngine,
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
import type { EntityManager, EntityMetadata, ObjectLiteral } from 'typeorm';

import type { ActivityLogSubscriberOptions } from './activity-log.types';
import { getLogsActivityOptions } from './logs-activity.decorator';

export interface RecordTypeOrmActivityInput {
  metadata: EntityMetadata;
  manager: EntityManager;
  defaults: ActivityLogSubscriberOptions;
  event: ActivityEvent;
  old: Record<string, unknown>;
  attributes: Record<string, unknown>;
  entity: ObjectLiteral;
  dirty?: readonly string[];
  callOptions?: LogOptions;
}

export async function recordTypeOrmActivity(input: RecordTypeOrmActivityInput): Promise<boolean> {
  const entityOptions = getLogsActivityOptions(input.metadata.target);
  if (entityOptions === undefined) {
    return false;
  }

  const id = entityId(input.metadata, input.entity);
  if (id === undefined) {
    return false;
  }

  const mergedOptions = mergeLogOptions(input.defaults.logOptions, entityOptions, input.callOptions);
  const resolvedOptions = resolveLogOptions(mergedOptions);
  const diff = DiffEngine.diff({
    old: input.old,
    attributes: input.attributes,
    dirty: input.dirty,
    options: resolvedOptions,
  });
  const subject = subjectRef(input.metadata.targetName, id);
  const description = resolvedOptions.descriptionForEvent?.({
    event: input.event,
    subject,
    diff,
  }) ?? `${input.metadata.targetName} ${input.event}`;
  const store = resolvedOptions.store ?? input.defaults.store;
  const logger = new ActivityLogger({
    store: transactionStore(store, input.manager),
    now: input.defaults.now,
    logOptions: mergedOptions,
  });

  await logger
    .activity(resolvedOptions.useLogName)
    .performedOn(subject)
    .event(input.event)
    .withProperties({ attributes: diff.attributes, old: diff.old })
    .log(description);
  return true;
}

export function entitySnapshot(metadata: EntityMetadata, entity: ObjectLiteral): Record<string, unknown> {
  return Object.fromEntries(
    metadata.columns
      .filter((column) => !column.isVirtual)
      .map((column) => [column.propertyPath, column.getEntityValue(entity)]),
  );
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
