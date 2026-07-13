import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SqlExecutorStore,
  disableLogging,
  enableLogging,
  runWithContext,
  withBatch,
  withoutLogging,
  type Activity,
  type ActivityStore,
} from 'activitylog-core';
import {
  auditedTransaction,
  prismaActivityLog,
  type PrismaActivityLogOptions,
} from 'activitylog-nextjs/prisma';

import { Prisma, PrismaClient } from '../.context/generated/prisma/client';

describe('Prisma activity-log adapter', () => {
  let directory: string;
  let databasePath: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'activitylog-prisma-'));
    databasePath = join(directory, 'test.db');
    createSchema(databasePath);
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${databasePath}` }),
    });
  });

  afterEach(async () => {
    enableLogging();
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  it('audits create, update, upsert and delete through $extends as best-effort operations', async () => {
    const client = prismaActivityLog(prisma, options());

    const created = await client.user.create({ data: { email: 'one@example.test', name: 'One' } });
    await client.user.update({ where: { id: created.id }, data: { name: 'Updated' } });
    await client.user.upsert({
      where: { email: 'one@example.test' },
      create: { email: 'one@example.test', name: 'Unused' },
      update: { name: 'Upserted' },
    });
    await client.user.delete({ where: { id: created.id } });

    const activities = await readActivities(prisma);
    expect(activities.map(({ event }) => event)).toEqual(['created', 'updated', 'updated', 'deleted']);
    expect(activities[1]).toMatchObject({
      subject: { type: 'User', id: String(created.id) },
      properties: {
        old: { id: created.id, email: 'one@example.test', name: 'One' },
        attributes: { id: created.id, email: 'one@example.test', name: 'Updated' },
      },
    });
  });

  it('classifies the create branch of an individual upsert as created', async () => {
    const client = prismaActivityLog(prisma, options());

    const created = await client.user.upsert({
      where: { email: 'new-upsert@example.test' },
      create: { email: 'new-upsert@example.test', name: 'Created by upsert' },
      update: { name: 'Never used' },
    });

    await expect(readActivities(prisma)).resolves.toEqual([
      expect.objectContaining({ event: 'created', subject: { type: 'User', id: String(created.id) } }),
    ]);
  });

  it('keeps mutation and Activity iff-committed in auditedTransaction', async () => {
    await auditedTransaction(prisma, options(), async (tx) => {
      await tx.user.create({ data: { email: 'committed@example.test', name: 'Committed' } });
    });

    await expect(prisma.user.count({ where: { email: 'committed@example.test' } })).resolves.toBe(1);
    await expect(readActivities(prisma)).resolves.toHaveLength(1);
  });

  it('supports a custom store only when it explicitly honours the transaction context', async () => {
    const store = prismaStore(prisma);

    await expect(
      auditedTransaction(
        prisma,
        { store, storeTransactionMode: 'uses-context', redact: false },
        async (tx) => tx.user.create({ data: { email: 'custom-store@example.test' } }),
      ),
    ).resolves.toMatchObject({ email: 'custom-store@example.test' });

    await expect(readActivities(prisma)).resolves.toHaveLength(1);
  });

  it('rejects an unqualified custom store before opening a transaction', async () => {
    await expect(
      auditedTransaction(
        prisma,
        { store: prismaStore(prisma), redact: false },
        async (tx) => tx.user.create({ data: { email: 'must-not-run@example.test' } }),
      ),
    ).rejects.toThrow('storeTransactionMode: "uses-context"');

    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it('rolls back both the mutation and Activity when the transaction callback fails', async () => {
    await expect(
      auditedTransaction(prisma, options(), async (tx) => {
        await tx.user.create({ data: { email: 'rollback@example.test', name: 'Rollback' } });
        throw new Error('rollback requested');
      }),
    ).rejects.toThrow('rollback requested');

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(readActivities(prisma)).resolves.toEqual([]);
  });

  it('rolls the mutation back when Activity persistence fails inside auditedTransaction', async () => {
    await expect(
      auditedTransaction(
        prisma,
        options({ beforePersist: () => { throw new Error('activity failed'); } }),
        async (tx) => tx.user.create({ data: { email: 'failed@example.test' } }),
      ),
    ).rejects.toThrow('activity failed');

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(readActivities(prisma)).resolves.toEqual([]);
  });

  it('documents best-effort by keeping a mutation whose later Activity write fails', async () => {
    const failingStore: ActivityStore = {
      persist: async () => { throw new Error('store unavailable'); },
      query: async () => [],
      prune: async () => 0,
    };
    const client = prismaActivityLog(prisma, { store: failingStore, redact: false });

    await expect(
      client.user.create({ data: { email: 'best-effort@example.test' } }),
    ).rejects.toThrow('store unavailable');

    await expect(prisma.user.count({ where: { email: 'best-effort@example.test' } })).resolves.toBe(1);
  });

  it('records every supported bulk variant as one Aggregate activity', async () => {
    const client = prismaActivityLog(prisma, options());

    await client.user.createMany({
      data: [
        { email: 'bulk-one@example.test', name: 'Before' },
        { email: 'bulk-two@example.test', name: 'Before' },
      ],
    });
    await client.user.createManyAndReturn({
      data: [{ email: 'bulk-three@example.test', name: 'Before' }],
    });
    await client.user.updateMany({ where: { name: 'Before' }, data: { name: 'After' } });
    await client.user.updateManyAndReturn({
      where: { email: 'bulk-three@example.test' },
      data: { name: 'Returned' },
    });
    await client.user.deleteMany({ where: { name: 'After' } });

    const activities = await readActivities(prisma);
    expect(activities.map((activity) => ({
      event: activity.event,
      subject: activity.subject,
      affected: activity.properties.affected,
    }))).toEqual([
      { event: 'created', subject: { type: 'User', id: null }, affected: 2 },
      { event: 'created', subject: { type: 'User', id: null }, affected: 1 },
      { event: 'updated', subject: { type: 'User', id: null }, affected: 3 },
      { event: 'updated', subject: { type: 'User', id: null }, affected: 1 },
      { event: 'deleted', subject: { type: 'User', id: null }, affected: 2 },
    ]);
    expect(activities[2]?.properties).toEqual({
      aggregate: true,
      criteria: { name: 'Before' },
      changes: { name: 'After' },
      affected: 3,
    });
  });

  it('records configured nested create, update and both upsert branches as top-level Aggregates', async () => {
    const client = prismaActivityLog(prisma, options());

    const user = await client.user.create({
      data: {
        email: 'nested@example.test',
        posts: { create: { title: 'Nested post' } },
      },
    });
    await client.user.update({
      where: { id: user.id },
      data: { posts: { create: { title: 'Nested update' } } },
    });
    await client.user.upsert({
      where: { email: 'nested@example.test' },
      create: { email: 'nested@example.test' },
      update: { posts: { create: { title: 'Nested upsert update' } } },
    });
    await client.user.upsert({
      where: { email: 'nested-created@example.test' },
      create: {
        email: 'nested-created@example.test',
        posts: { create: { title: 'Nested upsert create' } },
      },
      update: { name: 'unused' },
    });

    const activities = await readActivities(prisma);
    expect(activities.map(({ event, subject }) => ({ event, subject }))).toEqual([
      { event: 'created', subject: { type: 'User', id: null } },
      { event: 'updated', subject: { type: 'User', id: null } },
      { event: 'updated', subject: { type: 'User', id: null } },
      { event: 'created', subject: { type: 'User', id: null } },
    ]);
    expect(activities[2]?.properties.changes).toEqual({
      create: { email: 'nested@example.test' },
      update: { posts: { create: { title: 'Nested upsert update' } } },
    });
    await expect(prisma.post.count()).resolves.toBe(4);
  });

  it('keeps bulk and nested Aggregate activities inside auditedTransaction', async () => {
    const user = await prisma.user.create({ data: { email: 'tx-aggregate@example.test', name: 'Before' } });

    await auditedTransaction(prisma, options(), async (tx) => {
      await tx.user.updateMany({ where: { name: 'Before' }, data: { name: 'After' } });
      await tx.user.update({
        where: { id: user.id },
        data: { posts: { create: { title: 'Transactional nested' } } },
      });
    });

    const activities = await readActivities(prisma);
    expect(activities).toHaveLength(2);
    expect(activities.every((activity) => activity.subject?.id === null)).toBe(true);
    await expect(prisma.post.count()).resolves.toBe(1);
  });

  it('rejects an explicit identity exclusion before running the mutation', async () => {
    const client = prismaActivityLog(prisma, options());

    await expect(
      client.user.create({
        data: { email: 'hidden-id@example.test' },
        omit: { id: true },
      }),
    ).rejects.toThrow('activitylog: Prisma adapter requires "id" in mutation results');

    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it('bypasses all audit work when request-local or global logging suppression is active', async () => {
    const client = prismaActivityLog(prisma, options());

    await withoutLogging(() => client.user.create({
      data: { email: 'without-logging@example.test' },
      omit: { id: true },
    }));
    disableLogging();
    await client.user.create({
      data: { email: 'disabled@example.test' },
      omit: { id: true },
    });
    enableLogging();

    await expect(prisma.user.count()).resolves.toBe(2);
    await expect(readActivities(prisma)).resolves.toEqual([]);
  });

  it('retains causer and batch context across Prisma lazy promises', async () => {
    const client = prismaActivityLog(prisma, options());

    await runWithContext({ causer: { type: 'User', id: 'actor-1' } }, () =>
      withBatch(() => client.user.create({ data: { email: 'context@example.test' } })),
    );

    await expect(readActivities(prisma)).resolves.toEqual([
      expect.objectContaining({
        causer: { type: 'User', id: 'actor-1' },
        batchUuid: expect.any(String),
      }),
    ]);
  });

  it('re-includes configured globally omitted fields only for the private audit diff', async () => {
    const omittedPrisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${databasePath}` }),
      omit: { user: { name: true } },
    });

    try {
      const client = prismaActivityLog(omittedPrisma, options({
        models: { User: { relationFields: ['posts'], auditFields: ['name'] } },
      }));
      const result = await client.user.create({
        data: { email: 'globally-omitted@example.test', name: 'Visible only to audit' },
      });

      expect(result).not.toHaveProperty('name');
      await expect(readActivities(prisma)).resolves.toEqual([
        expect.objectContaining({
          properties: {
            old: {},
            attributes: {
              id: result.id,
              email: 'globally-omitted@example.test',
              name: 'Visible only to audit',
            },
          },
        }),
      ]);
    } finally {
      await omittedPrisma.$disconnect();
    }
  });

  it('normalizes Prisma-specific values through the public Aggregate envelope', async () => {
    const client = prismaActivityLog(prisma, options());
    const occurredAt = new Date('2026-07-13T10:20:30.456Z');

    await client.auditValue.createMany({
      data: [
        {
          bigint: 42n,
          occurredAt,
          decimal: new Prisma.Decimal('12.3400'),
          bytes: Buffer.from('activitylog'),
          payload: Prisma.JsonNull,
        },
        {
          bigint: 43n,
          occurredAt,
          decimal: new Prisma.Decimal('13.00'),
          bytes: Buffer.from('database-null'),
          payload: Prisma.DbNull,
        },
      ],
    });
    await client.auditValue.updateMany({
      where: { payload: { equals: Prisma.AnyNull } },
      data: { decimal: new Prisma.Decimal('14.500') },
    });

    const activities = await readActivities(prisma);
    expect(activities[0]?.properties.changes).toEqual({
      data: [
        {
          bigint: '42',
          occurredAt: '2026-07-13T10:20:30.456Z',
          decimal: '12.34',
          bytes: { $bytes: 'YWN0aXZpdHlsb2c=' },
          payload: { $prismaNull: 'JsonNull' },
        },
        {
          bigint: '43',
          occurredAt: '2026-07-13T10:20:30.456Z',
          decimal: '13',
          bytes: { $bytes: 'ZGF0YWJhc2UtbnVsbA==' },
          payload: { $prismaNull: 'DbNull' },
        },
      ],
    });
    expect(activities[1]?.properties.criteria).toEqual({
      payload: { equals: { $prismaNull: 'AnyNull' } },
    });
    expect(occurredAt.toISOString()).toBe('2026-07-13T10:20:30.456Z');
  });

  it('rejects cyclic audit values through the public client before mutation', async () => {
    type ExtensionHandler = (input: {
      model: string;
      operation: string;
      args: Record<string, unknown>;
      query: (args: Record<string, unknown>) => Promise<unknown>;
    }) => Promise<unknown>;
    let handler: ExtensionHandler | undefined;
    const fakePrisma = {
      $extends: (extension: unknown) => {
        handler = (extension as {
          query: { $allModels: { $allOperations: ExtensionHandler } };
        }).query.$allModels.$allOperations;
        return {
          user: {
            create: (args: Record<string, unknown>) => handler?.({
              model: 'User',
              operation: 'create',
              args,
              query: async () => ({ id: 1 }),
            }),
          },
        };
      },
    };
    const inertStore: ActivityStore = {
      persist: async () => undefined,
      query: async () => [],
      prune: async () => 0,
    };
    const client = prismaActivityLog(fakePrisma, { store: inertStore, redact: false }) as unknown as {
      user: { create(args: Record<string, unknown>): Promise<unknown> };
    };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(
      client.user.create({ data: cyclic }),
    ).rejects.toThrow('activitylog: Prisma adapter cannot normalize a cyclic value');
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it('rejects lockForDiff instead of silently promising a lock Prisma cannot express', () => {
    expect(() => prismaActivityLog(prisma, {
      ...options(),
      lockForDiff: true,
    } as unknown as PrismaActivityLogOptions)).toThrow('does not support lockForDiff');
  });
});

function options(overrides: Record<string, unknown> = {}) {
  return {
    dialect: 'sqlite' as const,
    redact: false as const,
    models: {
      User: { relationFields: ['posts'] },
    },
    ...overrides,
  };
}

async function readActivities(prisma: PrismaClient): Promise<readonly Activity[]> {
  return prismaStore(prisma).query({ sort: 'asc' });
}

function prismaStore(prisma: PrismaClient): SqlExecutorStore {
  return new SqlExecutorStore({
    dataSource: {
      dialect: 'sqlite',
      execute: async (sql, params = []) => {
        if (/^\s*(select|pragma)/i.test(sql)) {
          return await prisma.$queryRawUnsafe(sql, ...params) as Record<string, unknown>[];
        }
        return [{ affectedRows: await prisma.$executeRawUnsafe(sql, ...params) }];
      },
    },
  });
}

function createSchema(path: string): void {
  const database = new Database(path);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "User" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "email" TEXT NOT NULL UNIQUE,
      "name" TEXT
    );
    CREATE TABLE "Post" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "title" TEXT NOT NULL,
      "authorId" INTEGER NOT NULL,
      CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE
    );
    CREATE TABLE "AuditValue" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "bigint" BIGINT NOT NULL,
      "occurredAt" DATETIME NOT NULL,
      "decimal" DECIMAL NOT NULL,
      "bytes" BLOB NOT NULL,
      "payload" JSONB
    );
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
    );
  `);
  database.close();
}
