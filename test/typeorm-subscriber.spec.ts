import 'reflect-metadata';

import {
  Column,
  DataSource,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SqlExecutorStore, type Activity, type SqlDataSource, type SqlRow } from 'activitylog-core';
import {
  ActivityLogSubscriber,
  DiffEngine,
  LogsActivity,
} from 'activitylog-nestjs/typeorm';

@LogsActivity({ logOnlyDirty: true, redact: false })
@Entity()
class Article {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column()
  body!: string;

  @DeleteDateColumn({ nullable: true })
  deletedAt!: Date | null;
}

@LogsActivity({ logOnly: ['name'], redact: false })
@Entity()
class OnlyName {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  internalCode!: string;
}

@LogsActivity({ logExcept: ['internalCode'], redact: false })
@Entity()
class ExceptInternalCode {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  internalCode!: string;
}

@LogsActivity()
@Entity()
class SubscriberDefaults {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  internalCode!: string;
}

class Address {
  @Column()
  city!: string;
}

@LogsActivity({ logOnlyDirty: true, redact: false })
@Entity()
class EmbeddedAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column(() => Address, { prefix: 'billing' })
  billing!: Address;

  @Column(() => Address, { prefix: 'shipping' })
  shipping!: Address;
}

@LogsActivity({ redact: false })
@Entity()
class PartialSave {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  note!: string;
}

describe('TypeORM activity subscriber', () => {
  let dataSource: DataSource;
  let store: SqlExecutorStore;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Article, OnlyName, ExceptInternalCode, SubscriberDefaults, EmbeddedAccount, PartialSave],
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

    store = new SqlExecutorStore({ dataSource: typeOrmDataSource(dataSource) });
    dataSource.subscribers.push(new ActivityLogSubscriber({
      store,
      logOptions: { logExcept: ['internalCode'], redact: false },
    }));
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('logs save, remove, and softRemove with old/new diffs', async () => {
    const repository = dataSource.getRepository(Article);
    const article = await repository.save(repository.create({ title: 'First', body: 'Body' }));

    article.title = 'Second';
    await repository.save(article);
    await repository.softRemove(article);

    const removable = await repository.save(repository.create({ title: 'Remove', body: 'Gone' }));
    const removableId = removable.id;
    await repository.remove(removable);

    const activities = await store.query({ sort: 'asc' });

    expect(activities.map(activitySummary)).toEqual([
      {
        event: 'created',
        subject: { type: 'Article', id: String(article.id) },
        attributes: { id: article.id, title: 'First', body: 'Body', deletedAt: null },
        old: {},
      },
      {
        event: 'updated',
        subject: { type: 'Article', id: String(article.id) },
        attributes: { title: 'Second' },
        old: { title: 'First' },
      },
      {
        event: 'deleted',
        subject: { type: 'Article', id: String(article.id) },
        attributes: { deletedAt: expect.any(String) },
        old: { deletedAt: null },
      },
      {
        event: 'created',
        subject: { type: 'Article', id: String(removableId) },
        attributes: { id: removableId, title: 'Remove', body: 'Gone', deletedAt: null },
        old: {},
      },
      {
        event: 'deleted',
        subject: { type: 'Article', id: String(removableId) },
        attributes: {},
        old: { id: removableId, title: 'Remove', body: 'Gone', deletedAt: null },
      },
    ]);
  });

  it('applies logOnly and logExcept to persisted diffs', async () => {
    await dataSource.getRepository(OnlyName).save({ name: 'visible', internalCode: 'hidden' });
    await dataSource.getRepository(ExceptInternalCode).save({ name: 'visible', internalCode: 'hidden' });
    await dataSource.getRepository(SubscriberDefaults).save({ name: 'visible', internalCode: 'hidden' });

    const activities = await store.query({ sort: 'asc' });

    expect(activities.map(({ properties }) => properties)).toEqual([
      { attributes: { name: 'visible' }, old: {} },
      { attributes: { id: 1, name: 'visible' }, old: {} },
      { attributes: { id: 1, name: 'visible' }, old: {} },
    ]);
  });

  it('rolls the Activity back with the mutation', async () => {
    let activityInsertUsedTransactionManager = false;

    await expect(
      dataSource.transaction(async (manager) => {
        const query = vi.spyOn(manager, 'query');
        await manager.save(Article, { title: 'Rollback', body: 'No trace' });
        activityInsertUsedTransactionManager = query.mock.calls.some(
          ([sql]) => typeof sql === 'string' && /insert into [`"]activity_log[`"]/i.test(sql),
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(activityInsertUsedTransactionManager).toBe(true);
    expect(await dataSource.getRepository(Article).count()).toBe(0);
    expect(await store.query({})).toEqual([]);
  });

  it('keeps repeated embedded property names distinct', async () => {
    const repository = dataSource.getRepository(EmbeddedAccount);
    const account = await repository.save(repository.create({
      billing: { city: 'Salvador' },
      shipping: { city: 'Recife' },
    }));

    account.billing.city = 'Fortaleza';
    await repository.save(account);

    const activities = await store.query({ event: 'updated' });
    expect(activities).toHaveLength(1);
    expect(activities[0]?.properties).toEqual({
      attributes: { 'billing.city': 'Fortaleza' },
      old: { 'billing.city': 'Salvador' },
    });
  });

  it('overlays partial save fields without reporting omitted columns as removed', async () => {
    const repository = dataSource.getRepository(PartialSave);
    const entity = await repository.save({ name: 'Before', note: 'Preserved' });

    await repository.save({ id: entity.id, name: 'After' });

    const activities = await store.query({ event: 'updated' });
    expect(activities).toHaveLength(1);
    expect(activities[0]?.properties).toEqual({
      attributes: { id: entity.id, name: 'After', note: 'Preserved' },
      old: { id: entity.id, name: 'Before', note: 'Preserved' },
    });
  });
});

describe('DiffEngine', () => {
  it('does not mutate inputs while selecting only dirty fields', () => {
    const old = { name: 'before', unchanged: { nested: true } };
    const attributes = { name: 'after', unchanged: { nested: true } };

    const diff = DiffEngine.diff({
      old,
      attributes,
      dirty: ['name', 'unchanged'],
      options: { logOnlyDirty: true },
    });

    expect(diff).toEqual({ attributes: { name: 'after' }, old: { name: 'before' } });
    expect(old).toEqual({ name: 'before', unchanged: { nested: true } });
    expect(attributes).toEqual({ name: 'after', unchanged: { nested: true } });
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

function activitySummary(activity: Activity): Record<string, unknown> {
  return {
    event: activity.event,
    subject: activity.subject,
    attributes: activity.properties.attributes,
    old: activity.properties.old,
  };
}
