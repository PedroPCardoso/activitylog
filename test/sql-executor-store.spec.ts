import { describe, expect, it } from 'vitest';

import {
  InvalidIdentifierException,
  SqlExecutorStore,
  aggregateSubjectRef,
  createActivityLogger,
  subjectRef,
  type NewActivity,
  type SqlDataSource,
  type TransactionRef,
} from 'activitylog-core';

import { createSqliteActivityLogSchema, createSqliteTestDatabase } from './helpers/sqlite-executor';

function activity(overrides: Partial<NewActivity> = {}): NewActivity {
  return {
    logName: 'default',
    description: 'created',
    subject: null,
    causer: null,
    event: null,
    properties: {},
    batchUuid: null,
    createdAt: new Date('2026-07-12T10:20:30.123Z'),
    ...overrides,
  };
}

describe('SqlExecutorStore', () => {
  it('rejects an unsafe custom table name before executing SQL', () => {
    const sqlite = createSqliteTestDatabase();

    expect(
      () => new SqlExecutorStore({ dataSource: sqlite.dataSource, tableName: 'activity_log; DROP TABLE users' }),
    ).toThrow(InvalidIdentifierException);
  });

  it('persists and reads manual activities from SQLite memory', async () => {
    const sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    const store = new SqlExecutorStore({ dataSource: sqlite.dataSource });

    await createActivityLogger({ store })
      .activity('billing')
      .performedOn(subjectRef('Order', 12))
      .withProperties({ plan: 'pro' })
      .event('created')
      .log('created');

    await expect(store.query({ logName: 'billing' })).resolves.toEqual([
      expect.objectContaining({
        logName: 'billing',
        description: 'created',
        subject: { type: 'Order', id: '12' },
        event: 'created',
        properties: { plan: 'pro' },
      }),
    ]);
  });

  it('preserves an Aggregate subject type when its id is null', async () => {
    const sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    const store = new SqlExecutorStore({ dataSource: sqlite.dataSource });

    await createActivityLogger({ store })
      .activity()
      .performedOn(aggregateSubjectRef('User'))
      .withProperties({ aggregate: true, criteria: {}, changes: {}, affected: 2 })
      .event('updated')
      .log('User updated');

    await expect(store.query({})).resolves.toEqual([
      expect.objectContaining({
        subject: { type: 'User', id: null },
        properties: { aggregate: true, criteria: {}, changes: {}, affected: 2 },
      }),
    ]);
  });

  it('uses the provided transaction executor for persistence', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const dataSource: SqlDataSource = {
      dialect: 'sqlite',
      execute: async () => [],
    };
    const transaction: TransactionRef = {
      execute: async (sql, params) => {
        calls.push({ sql, params });
        return [];
      },
    };
    const store = new SqlExecutorStore({ dataSource });

    await store.persist([activity()], transaction);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('INSERT INTO "activity_log"');
  });

  it('formats temporal query bounds as UTC datetime values for MySQL', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const dataSource: SqlDataSource = {
      dialect: 'mysql',
      execute: async (sql, params) => {
        calls.push({ sql, params });
        return [];
      },
    };
    const store = new SqlExecutorStore({ dataSource });

    await store.query({ from: new Date('2026-07-12T10:20:30.123Z') });

    expect(calls[0]?.params).toEqual(['2026-07-12 10:20:30.123']);
  });

  it('maps nullable driver rows and clones Date values', async () => {
    const createdAt = new Date('2026-07-12T10:20:30.123Z');
    const dataSource: SqlDataSource = {
      dialect: 'postgres',
      execute: async () => [
        {
          id: 1,
          log_name: 'default',
          description: 'system activity',
          subject_type: null,
          subject_id: null,
          causer_type: undefined,
          causer_id: undefined,
          event: undefined,
          properties: null,
          batch_uuid: undefined,
          created_at: createdAt,
        },
      ],
    };
    const store = new SqlExecutorStore({ dataSource });

    const rows = await store.query({});

    expect(rows).toEqual([
      expect.objectContaining({
        subject: null,
        causer: null,
        event: null,
        properties: {},
        batchUuid: null,
        createdAt,
      }),
    ]);
    expect(rows[0]?.createdAt).not.toBe(createdAt);
  });

  it('normalizes driver-specific affected row counts when pruning', async () => {
    const dataSource: SqlDataSource = {
      dialect: 'postgres',
      execute: async () => [{ rowCount: '2' }],
    };
    const store = new SqlExecutorStore({ dataSource });

    await expect(
      store.prune(new Date('2026-07-12T10:20:30.123Z')),
    ).resolves.toBe(2);
  });

  it('supports property and cursor filters', async () => {
    const sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    const store = new SqlExecutorStore({ dataSource: sqlite.dataSource });

    await store.persist([
      activity({ properties: { plan: 'pro' }, createdAt: new Date('2026-07-12T00:00:00.000Z') }),
      activity({ properties: { plan: 'other' }, createdAt: new Date('2026-07-12T00:00:01.000Z') }),
    ]);

    await expect(store.query({ properties: [{ path: 'plan', operator: '=', value: 'pro' }] })).resolves.toEqual([
      expect.objectContaining({ properties: { plan: 'pro' } }),
    ]);
    await expect(
      store.query({ cursor: { createdAt: new Date('2026-07-12T00:00:01.000Z'), id: 2 } }),
    ).resolves.toHaveLength(1);
  });

  it('prunes by timestamp and optional log name', async () => {
    const sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    const store = new SqlExecutorStore({ dataSource: sqlite.dataSource });

    await store.persist([
      activity({ logName: 'billing', createdAt: new Date('2020-01-01T00:00:00.000Z') }),
      activity({ logName: 'other', createdAt: new Date('2020-01-01T00:00:00.000Z') }),
      activity({ logName: 'billing', createdAt: new Date('2030-01-01T00:00:00.000Z') }),
    ]);

    await expect(store.prune(new Date('2021-01-01T00:00:00.000Z'), 'billing')).resolves.toBe(1);
    await expect(store.query({ sort: 'asc' })).resolves.toHaveLength(2);
  });

  it('serializes properties with a canonical key order', async () => {
    const sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    const store = new SqlExecutorStore({ dataSource: sqlite.dataSource });

    await store.persist([activity({ properties: { z: 1, a: { d: 2, b: 3 } } })]);

    const rows = sqlite.database.prepare('SELECT properties FROM activity_log').all() as Array<{ properties: string }>;
    expect(rows[0]?.properties).toBe('{"a":{"b":3,"d":2},"z":1}');
  });
});
