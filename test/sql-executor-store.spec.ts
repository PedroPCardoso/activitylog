import { describe, expect, it } from 'vitest';

import {
  InvalidIdentifierException,
  SqlExecutorStore,
  UnsupportedActivityFilterException,
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

  it('rejects unsupported property and cursor filters explicitly', async () => {
    const sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    const store = new SqlExecutorStore({ dataSource: sqlite.dataSource });

    await expect(store.query({ properties: [{ path: 'plan', operator: '=', value: 'pro' }] })).rejects.toThrow(
      UnsupportedActivityFilterException,
    );
    await expect(
      store.query({ cursor: { createdAt: new Date('2026-07-12T00:00:00.000Z'), id: 1 } }),
    ).rejects.toThrow(/^activitylog:/);
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
