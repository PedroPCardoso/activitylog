import type {
  EntitySubscriberInterface,
  InsertEvent,
  ObjectLiteral,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';

import { entitySnapshot, recordTypeOrmActivity } from './activity-recorder';
import type { ActivityLogSubscriberOptions } from './activity-log.types';

export class ActivityLogSubscriber implements EntitySubscriberInterface<ObjectLiteral> {
  constructor(private readonly options: ActivityLogSubscriberOptions) {}

  async afterInsert(event: InsertEvent<ObjectLiteral>): Promise<void> {
    await recordTypeOrmActivity({
      metadata: event.metadata,
      manager: event.manager,
      defaults: this.options,
      event: 'created',
      old: {},
      attributes: entitySnapshot(event.metadata, event.entity),
      entity: event.entity,
    });
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    if (event.entity === undefined || event.databaseEntity === undefined) {
      return;
    }

    const old = entitySnapshot(event.metadata, event.databaseEntity);
    const dirty = event.updatedColumns.map((column) => column.propertyPath);

    await recordTypeOrmActivity({
      metadata: event.metadata,
      manager: event.manager,
      defaults: this.options,
      event: 'updated',
      old,
      attributes: overlaySnapshot(old, entitySnapshot(event.metadata, event.entity), dirty),
      entity: event.entity,
      dirty,
    });
  }

  async afterRemove(event: RemoveEvent<ObjectLiteral>): Promise<void> {
    if (event.databaseEntity === undefined) {
      return;
    }

    await recordTypeOrmActivity({
      metadata: event.metadata,
      manager: event.manager,
      defaults: this.options,
      event: 'deleted',
      old: entitySnapshot(event.metadata, event.databaseEntity),
      attributes: {},
      entity: event.databaseEntity,
    });
  }

  async afterSoftRemove(event: SoftRemoveEvent<ObjectLiteral>): Promise<void> {
    if (event.entity === undefined || event.databaseEntity === undefined) {
      return;
    }

    const old = entitySnapshot(event.metadata, event.databaseEntity);
    await recordTypeOrmActivity({
      metadata: event.metadata,
      manager: event.manager,
      defaults: this.options,
      event: 'deleted',
      old,
      attributes: overlayDefinedSnapshot(old, entitySnapshot(event.metadata, event.entity)),
      entity: event.entity,
    });
  }
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
