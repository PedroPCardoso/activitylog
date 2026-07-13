import {
  mergeLogOptions,
  resolveLogOptions,
  type LogOptions,
} from 'activitylog-core';
import {
  UpdateResult,
  type FindOptionsWhere,
  type ObjectLiteral,
  type QueryDeepPartialEntity,
  type Repository,
} from 'typeorm';

import { entitySnapshot, recordTypeOrmActivity } from './activity-recorder';
import type { ActivityLogSubscriberOptions } from './activity-log.types';
import { getLogsActivityOptions } from './logs-activity.decorator';
import { getActivityLogSubscriberOptions } from './subscriber-registration';

export async function auditedUpdate<Entity extends ObjectLiteral>(
  repository: Repository<Entity>,
  criteria: FindOptionsWhere<Entity>,
  patch: QueryDeepPartialEntity<Entity>,
  callOptions: LogOptions = {},
): Promise<UpdateResult> {
  const entityOptions = getLogsActivityOptions(repository.metadata.target);
  if (entityOptions === undefined) {
    throw new Error('activitylog: auditedUpdate requires an entity decorated with @LogsActivity()');
  }
  if (repository.metadata.hasMultiplePrimaryKeys) {
    throw new Error('activitylog: auditedUpdate does not support composite primary keys');
  }

  const registered = getActivityLogSubscriberOptions(repository.manager.connection);
  const defaults = resolveDefaults(registered, entityOptions, callOptions);
  const resolvedOptions = resolveLogOptions(mergeLogOptions(defaults.logOptions, entityOptions, callOptions));

  return repository.manager.transaction(async (manager) => {
    const transactionalRepository = manager.getRepository(repository.target);
    const query = transactionalRepository
      .createQueryBuilder('activitylog_entity')
      .setFindOptions({ where: criteria })
      .take(2);

    if (resolvedOptions.lockForDiff) {
      query.setLock('pessimistic_write');
    }

    const matches = await query.getMany();
    if (matches.length === 0) {
      return emptyUpdateResult();
    }
    if (matches.length > 1) {
      throw new Error('activitylog: auditedUpdate criteria matched more than one row; bulk updates require an Aggregate activity');
    }

    const before = matches[0] as Entity;
    const id = transactionalRepository.metadata.getEntityIdMap(before);
    if (id === undefined) {
      throw new Error('activitylog: auditedUpdate could not resolve the entity primary key');
    }

    const primaryCriteria = id as FindOptionsWhere<Entity>;
    const result = await transactionalRepository.update(primaryCriteria, patch);
    if (result.affected !== undefined && result.affected !== 1) {
      throw new Error(`activitylog: auditedUpdate expected one affected row, received ${result.affected}`);
    }

    const after = await transactionalRepository.findOneByOrFail(primaryCriteria);
    const recorded = await recordTypeOrmActivity({
      metadata: transactionalRepository.metadata,
      manager,
      defaults,
      event: 'updated',
      old: entitySnapshot(transactionalRepository.metadata, before),
      attributes: entitySnapshot(transactionalRepository.metadata, after),
      entity: after,
      callOptions,
    });
    if (!recorded) {
      throw new Error('activitylog: auditedUpdate could not record the updated entity');
    }
    return result;
  });
}

function resolveDefaults(
  registered: ActivityLogSubscriberOptions | undefined,
  entityOptions: Readonly<LogOptions>,
  callOptions: LogOptions,
): ActivityLogSubscriberOptions {
  const merged = mergeLogOptions(registered?.logOptions, entityOptions, callOptions);
  const store = merged.store ?? registered?.store;
  if (store === undefined) {
    throw new Error('activitylog: auditedUpdate requires registerActivityLogSubscriber() or a configured store');
  }

  return {
    store,
    logOptions: registered?.logOptions,
    now: registered?.now,
  };
}

function emptyUpdateResult(): UpdateResult {
  const result = new UpdateResult();
  result.raw = [];
  result.affected = 0;
  result.generatedMaps = [];
  return result;
}
