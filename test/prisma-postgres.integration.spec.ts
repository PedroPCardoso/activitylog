import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqlExecutorStore, type Activity } from 'activitylog-core';
import { auditedTransaction, prismaActivityLog } from 'activitylog-nextjs/prisma';

import { PrismaClient } from '../.context/generated/prisma-postgres/client';

const describePostgres = process.env.PG_HOST ? describe : describe.skip;

describePostgres('Prisma PostgreSQL activity-log adapter', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    const pool = new Pool({ connectionString: postgresUrl() });
    await pool.query(`
      DROP TABLE IF EXISTS activity_log;
      DROP TABLE IF EXISTS "Post";
      DROP TABLE IF EXISTS "User";
      CREATE TABLE "User" (
        "id" SERIAL PRIMARY KEY,
        "email" TEXT NOT NULL UNIQUE,
        "name" TEXT
      );
      CREATE TABLE "Post" (
        "id" SERIAL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "authorId" INTEGER NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE
      );
      CREATE TABLE activity_log (
        id BIGSERIAL PRIMARY KEY,
        log_name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        subject_type VARCHAR(255),
        subject_id VARCHAR(255),
        causer_type VARCHAR(255),
        causer_id VARCHAR(255),
        event VARCHAR(255),
        properties JSONB NOT NULL,
        batch_uuid UUID,
        created_at TIMESTAMPTZ NOT NULL
      );
    `);
    await pool.end();
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl() }),
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('audits an individual update and an Aggregate bulk write', async () => {
    const client = prismaActivityLog(prisma, { dialect: 'postgres', redact: false });
    const user = await client.user.create({ data: { email: 'postgres@example.test', name: 'Before' } });
    await client.user.update({ where: { id: user.id }, data: { name: 'After' } });
    await client.user.updateMany({ where: { name: 'After' }, data: { name: 'Bulk' } });

    const activities = await readActivities(prisma);
    expect(activities.map(({ event, subject }) => ({ event, subject }))).toEqual([
      { event: 'created', subject: { type: 'User', id: String(user.id) } },
      { event: 'updated', subject: { type: 'User', id: String(user.id) } },
      { event: 'updated', subject: { type: 'User', id: null } },
    ]);
  });

  it('rolls model and Activity rows back together', async () => {
    await expect(
      auditedTransaction(
        prisma,
        { dialect: 'postgres', redact: false },
        async (tx) => {
          await tx.user.create({ data: { email: 'rollback-postgres@example.test' } });
          throw new Error('rollback postgres');
        },
      ),
    ).rejects.toThrow('rollback postgres');

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(readActivities(prisma)).resolves.toEqual([]);
  });
});

async function readActivities(prisma: PrismaClient): Promise<readonly Activity[]> {
  const store = new SqlExecutorStore({
    dataSource: {
      dialect: 'postgres',
      execute: async (sql, params = []) => {
        if (/^\s*(select|with)\b/i.test(sql)) {
          return await prisma.$queryRawUnsafe(sql, ...params) as Record<string, unknown>[];
        }
        return [{ affectedRows: await prisma.$executeRawUnsafe(sql, ...params) }];
      },
    },
  });
  return store.query({ sort: 'asc' });
}

function postgresUrl(): string {
  const user = encodeURIComponent(process.env.PG_USER ?? 'activitylog');
  const password = encodeURIComponent(process.env.PG_PASSWORD ?? 'activitylog');
  const host = process.env.PG_HOST ?? '127.0.0.1';
  const port = process.env.PG_PORT ?? '5432';
  const database = process.env.PG_DATABASE ?? 'activitylog';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}
