import 'reflect-metadata';

import {
  Column,
  DataSource,
  Entity,
  PrimaryGeneratedColumn,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SqlExecutorStore, type SqlDataSource, type SqlRow } from 'activitylog-core';
import {
  ActivityLogSubscriber,
  LogsActivity,
  auditedUpdate,
  registerActivityLogSubscriber,
} from 'activitylog-nestjs/typeorm';

@LogsActivity({ logOnlyDirty: true, redact: false })
@Entity()
class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  stock!: number;
}

describe('auditedUpdate', () => {
  let dataSource: DataSource;
  let store: SqlExecutorStore;
  let firstId: number;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Product],
      synchronize: true,
    });
    await dataSource.initialize();
    await dataSource.query(`
      CREATE TABLE activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        log_name TEXT NOT NULL,
        description TEXT NOT NULL,
        subject_type TEXT,
        subject_id TEXT,
        causer_type TEXT,
        causer_id TEXT,
        event TEXT,
        properties TEXT NOT NULL,
        batch_uuid TEXT,
        created_at TEXT NOT NULL
      )
    `);

    const repository = dataSource.getRepository(Product);
    const first = await repository.save({ name: 'First', stock: 10 });
    await repository.save({ name: 'Second', stock: 10 });
    firstId = first.id;

    store = new SqlExecutorStore({ dataSource: typeOrmDataSource(dataSource) });
    registerActivityLogSubscriber(dataSource, {
      store,
      logOptions: { logOnly: ['name'], useLogName: 'registered' },
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('re-reads, updates, and records the diff in one helper call', async () => {
    const repository = dataSource.getRepository(Product);
    const update = vi.spyOn(Repository.prototype, 'update');

    const result = await auditedUpdate(repository, { name: 'First' }, { name: 'Renamed' });

    expect(result.affected).toBe(1);
    expect(update).toHaveBeenCalledWith({ id: firstId }, { name: 'Renamed' });
    await expect(repository.findOneByOrFail({ id: firstId })).resolves.toMatchObject({
      name: 'Renamed',
      stock: 10,
    });
    const activities = await store.query({});
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      event: 'updated',
      subject: { type: 'Product', id: String(firstId) },
      properties: {
        attributes: { name: 'Renamed' },
        old: { name: 'First' },
      },
    });
  });

  it('returns an affected-zero result without creating an Activity', async () => {
    const result = await auditedUpdate(dataSource.getRepository(Product), { id: 999 }, { name: 'Missing' });

    expect(result.affected).toBe(0);
    expect(await store.query({})).toEqual([]);
  });

  it('rejects criteria that match multiple rows instead of fabricating per-row diffs', async () => {
    await expect(
      auditedUpdate(dataSource.getRepository(Product), { stock: 10 }, { name: 'Bulk' }),
    ).rejects.toThrow('activitylog: auditedUpdate criteria matched more than one row');

    expect(await dataSource.getRepository(Product).countBy({ name: 'Bulk' })).toBe(0);
    expect(await store.query({})).toEqual([]);
  });

  it('rolls the mutation back when the Activity pipeline fails', async () => {
    await expect(
      auditedUpdate(
        dataSource.getRepository(Product),
        { id: firstId },
        { name: 'Never commits' },
        { beforePersist: () => { throw new Error('activity failed'); } },
      ),
    ).rejects.toThrow('activity failed');

    await expect(dataSource.getRepository(Product).findOneByOrFail({ id: firstId })).resolves.toMatchObject({
      name: 'First',
    });
    expect(await store.query({})).toEqual([]);
  });

  it('keeps the Activity inside an existing outer transaction', async () => {
    await expect(
      dataSource.transaction(async (manager) => {
        await auditedUpdate(manager.getRepository(Product), { id: firstId }, { name: 'Outer rollback' });
        throw new Error('rollback outer');
      }),
    ).rejects.toThrow('rollback outer');

    await expect(dataSource.getRepository(Product).findOneByOrFail({ id: firstId })).resolves.toMatchObject({
      name: 'First',
    });
    expect(await store.query({})).toEqual([]);
  });

  it('applies call options after registration and decorator options', async () => {
    await auditedUpdate(
      dataSource.getRepository(Product),
      { id: firstId },
      { name: 'Ignored by selection', stock: 11 },
      { logOnly: ['stock'], useLogName: 'call' },
    );

    const activities = await store.query({});
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      logName: 'call',
      properties: {
        attributes: { stock: 11 },
        old: { stock: 10 },
      },
    });
  });

  it('requests a pessimistic write lock when lockForDiff is enabled', async () => {
    const setLock = vi.spyOn(SelectQueryBuilder.prototype, 'setLock').mockReturnThis();

    await auditedUpdate(
      dataSource.getRepository(Product),
      { id: firstId },
      { stock: 11 },
      { lockForDiff: true },
    );

    expect(setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  it('can register again after the DataSource is destroyed and reinitialized', async () => {
    await dataSource.destroy();
    await dataSource.initialize();

    expect(() => registerActivityLogSubscriber(dataSource, { store })).not.toThrow();
    expect(dataSource.subscribers.filter(
      (subscriber) => subscriber instanceof ActivityLogSubscriber,
    )).toHaveLength(1);
  });

  it('rejects mixing manual and helper subscriber registration', () => {
    dataSource.subscribers.length = 0;
    dataSource.subscribers.push(new ActivityLogSubscriber({ store }));

    expect(() => registerActivityLogSubscriber(dataSource, { store })).toThrow(
      'activitylog: a TypeORM activity subscriber is already registered for this DataSource',
    );
  });
});

function typeOrmDataSource(dataSource: DataSource): SqlDataSource {
  return {
    dialect: 'sqlite',
    execute: async (sql, params = []) => normalizeRows(await dataSource.manager.query(sql, [...params])),
  };
}

function normalizeRows(value: unknown): readonly SqlRow[] {
  return Array.isArray(value) ? value as SqlRow[] : [];
}
