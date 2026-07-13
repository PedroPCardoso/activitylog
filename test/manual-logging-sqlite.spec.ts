import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SqlExecutorStore,
  causerRef,
  createActivityLogger,
  subjectRef,
  type ActivityLogger,
  type ActivityStore,
} from 'activitylog-core';

import { createSqliteActivityLogSchema, createSqliteTestDatabase, type SqliteTestDatabase } from './helpers/sqlite-executor';

describe('manual logging parity in SQLite', () => {
  let sqlite: SqliteTestDatabase;
  let store: ActivityStore;
  let logger: ActivityLogger;

  beforeEach(() => {
    sqlite = createSqliteTestDatabase();
    createSqliteActivityLogSchema(sqlite.database);
    store = new SqlExecutorStore({ dataSource: sqlite.dataSource });
    logger = createActivityLogger({ store });
  });

  afterEach(() => {
    sqlite.database.close();
  });

  it('logs the basic manual description', async () => {
    await logger.activity().log('Look mum, I logged something');

    await expect(store.query({})).resolves.toEqual([
      expect.objectContaining({ description: 'Look mum, I logged something' }),
    ]);
  });

  it('persists performedOn and its on alias', async () => {
    await logger.activity().performedOn(subjectRef('Content', 1)).log('edited');
    await logger.activity().on(subjectRef('Content', 2)).log('edited again');

    await expect(store.query({ subject: { type: 'Content' }, sort: 'asc' })).resolves.toEqual([
      expect.objectContaining({ subject: { type: 'Content', id: '1' } }),
      expect.objectContaining({ subject: { type: 'Content', id: '2' } }),
    ]);
  });

  it('persists causedBy, its by alias and anonymous causers', async () => {
    await logger.activity().causedBy(causerRef('User', 'u1')).log('one');
    await logger.activity().by(causerRef('User', 'u2')).log('two');
    await logger.activity().causedBy(causerRef('User', 'u3')).byAnonymous().log('three');

    await expect(store.query({ sort: 'asc' })).resolves.toEqual([
      expect.objectContaining({ causer: { type: 'User', id: 'u1' } }),
      expect.objectContaining({ causer: { type: 'User', id: 'u2' } }),
      expect.objectContaining({ causer: null }),
    ]);
  });

  it('persists arbitrary properties', async () => {
    await logger.activity().withProperties({ key: 'value' }).log('edited');

    await expect(store.query({})).resolves.toEqual([
      expect.objectContaining({ properties: { key: 'value' } }),
    ]);
  });

  it('persists an application-defined UTC createdAt', async () => {
    await logger.activity().createdAt(new Date('2026-07-02T10:20:30.456Z')).log('created');

    const activities = await store.query({});
    expect(activities[0]?.createdAt.toISOString()).toBe('2026-07-02T10:20:30.456Z');
  });

  it('persists custom events', async () => {
    await logger.activity().event('verified').log('The user has verified the content model.');

    await expect(store.query({ event: 'verified' })).resolves.toEqual([
      expect.objectContaining({ description: 'The user has verified the content model.', event: 'verified' }),
    ]);
  });

  it('lets tap enrich the persisted activity through properties', async () => {
    await logger
      .activity()
      .tap((activity) => ({ ...activity, properties: { ...activity.properties, customField: 'special value' } }))
      .log('edited');

    await expect(store.query({})).resolves.toEqual([
      expect.objectContaining({ properties: { customField: 'special value' } }),
    ]);
  });
});
