import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SqlExecutorStore,
  activityQuery,
  causerRef,
  subjectRef,
  type ActivityStore,
  type NewActivity,
} from 'activitylog-core';

import { createSqliteActivityLogSchema, createSqliteTestDatabase, type SqliteTestDatabase } from './helpers/sqlite-executor';

function activity(overrides: Partial<NewActivity>): NewActivity {
  return {
    logName: 'billing',
    description: 'created',
    subject: subjectRef('Order', 'o1'),
    causer: causerRef('User', 'u1'),
    event: 'created',
    properties: { plan: 'pro' },
    batchUuid: 'batch-1',
    createdAt: new Date('2026-07-12T10:20:30.123Z'),
    ...overrides,
  };
}

describe('activityQuery', () => {
  let sqlite: SqliteTestDatabase;
  let store: ActivityStore;

  beforeEach(async () => {
    sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    store = new SqlExecutorStore({ dataSource: sqlite.dataSource });
    await store.persist([
      activity({ description: 'matched', createdAt: new Date('2026-07-12T10:20:30.100Z') }),
      activity({ description: 'other log', logName: 'other', createdAt: new Date('2026-07-12T10:20:30.200Z') }),
      activity({ description: 'aggregate', properties: { aggregate: true }, createdAt: new Date('2026-07-12T10:20:30.300Z') }),
      activity({ description: 'starter', createdAt: new Date('2026-07-12T10:20:30.400Z') }),
      activity({ description: 'finisher', createdAt: new Date('2026-07-12T10:20:30.500Z') }),
    ]);
  });

  afterEach(() => {
    sqlite.database.close();
  });

  it('applies the structured Spatie-equivalent scopes', async () => {
    const page = await activityQuery(store)
      .inLog('billing')
      .forSubject('Order', 'o1')
      .causedBy('User', 'u1')
      .forEvent('created')
      .forBatch('batch-1')
      .between(new Date('2026-07-12T10:20:30.000Z'), new Date('2026-07-12T10:20:30.150Z'))
      .paginate(10);

    expect(page.items).toEqual([expect.objectContaining({ description: 'matched' })]);
    expect(page.nextCursor).toBeNull();
  });

  it('filters properties and includes or excludes aggregate activities explicitly', async () => {
    const matching = await activityQuery(store).whereProperty('plan', 'pro').paginate(10);
    const withoutAggregates = await activityQuery(store).withAggregates(false).paginate(10);
    const onlySelection = await activityQuery(store).withAggregates(true).paginate(10);

    expect(matching.items.map((item) => item.description)).toContain('matched');
    expect(withoutAggregates.items.map((item) => item.description)).not.toContain('aggregate');
    expect(onlySelection.items.map((item) => item.description)).toContain('aggregate');
  });

  it('paginates by the stable createdAt and id cursor without duplicates', async () => {
    const first = await activityQuery(store).inLog('billing').paginate(2);
    const second = await activityQuery(store).inLog('billing').paginate(2, first.nextCursor ?? undefined);

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items).toHaveLength(2);
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids)).toHaveLength(ids.length);
  });
});
