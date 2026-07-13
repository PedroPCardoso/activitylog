const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const consumer = mkdtempSync(join(tmpdir(), 'activitylog-prisma-consumer-'));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? consumer,
    encoding: 'utf8',
    env: process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

function pack(workspace) {
  const output = run('npm', ['pack', '--pack-destination', consumer], {
    cwd: resolve(root, workspace),
    capture: true,
  });
  const filename = output.trim().split(/\r?\n/).at(-1);
  assert(filename, `npm pack did not return a filename for ${workspace}`);
  return resolve(consumer, filename);
}

try {
  const expectedCoreVersion = JSON.parse(
    readFileSync(resolve(root, 'packages/core/package.json')),
  ).version;
  const expectedNextVersion = JSON.parse(
    readFileSync(resolve(root, 'packages/activitylog-nextjs/package.json')),
  ).version;
  const coreTarball = pack('packages/core');
  const nextTarball = pack('packages/activitylog-nextjs');

  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'activitylog-prisma-consumer-smoke',
    version: '1.0.0',
    private: true,
    type: 'module',
  }, null, 2));

  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    coreTarball,
    nextTarball,
    '@prisma/client@7.8.0',
    '@prisma/adapter-better-sqlite3@7.8.0',
    'better-sqlite3@12.11.1',
    'prisma@7.8.0',
    'tsx@4.20.6',
  ]);

  mkdirSync(join(consumer, 'prisma'));
  writeFileSync(join(consumer, 'prisma/schema.prisma'), `
generator client {
  provider = "prisma-client"
  output   = "../generated"
}

datasource db {
  provider = "sqlite"
}

model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
`);

  run(join(consumer, 'node_modules/.bin/prisma'), [
    'generate',
    '--schema',
    join(consumer, 'prisma/schema.prisma'),
  ]);

  writeFileSync(join(consumer, 'app.ts'), `
import { createRequire } from 'node:module';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import Database from 'better-sqlite3';
import { PrismaClient } from './generated/client';

const require = createRequire(import.meta.url);
const core = require('activitylog-core');
const prismaAdapter = require('activitylog-nextjs/prisma');
const databasePath = join(process.cwd(), 'smoke.db');
const database = new Database(databasePath);
database.exec(\`
  CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL UNIQUE,
    "name" TEXT
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
\`);
database.close();

assert.equal(prismaAdapter.createActivityLogger, core.createActivityLogger);
assert.equal(typeof prismaAdapter.prismaActivityLog, 'function');
assert.equal(typeof prismaAdapter.auditedTransaction, 'function');

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: \`file:\${databasePath}\` }),
});
const options = { dialect: 'sqlite', redact: false } as const;
const client = prismaAdapter.prismaActivityLog(prisma, options);
const store = new core.SqlExecutorStore({
  dataSource: {
    dialect: 'sqlite',
    execute: async (sql: string, params: unknown[] = []) => {
      if (/^\\s*(select|pragma)/i.test(sql)) {
        return prisma.$queryRawUnsafe(sql, ...params);
      }
      return [{ affectedRows: await prisma.$executeRawUnsafe(sql, ...params) }];
    },
  },
});

try {
  const user = await client.user.create({
    data: { email: 'consumer@example.test', name: 'Consumer' },
  });
  let activities = await store.query({ sort: 'asc' });
  assert.equal(activities.length, 1);
  assert.deepEqual(activities[0].subject, { type: 'User', id: String(user.id) });
  assert.equal(activities[0].event, 'created');

  await assert.rejects(
    prismaAdapter.auditedTransaction(prisma, options, async (tx: typeof prisma) => {
      await tx.user.create({ data: { email: 'rollback@example.test' } });
      throw new Error('rollback smoke');
    }),
    /rollback smoke/,
  );

  assert.equal(await prisma.user.count({ where: { email: 'rollback@example.test' } }), 0);
  activities = await store.query({ sort: 'asc' });
  assert.equal(activities.length, 1);
} finally {
  await prisma.$disconnect();
}
`);

  run(join(consumer, 'node_modules/.bin/tsx'), ['app.ts']);

  const installedCore = JSON.parse(readFileSync(join(consumer, 'node_modules/activitylog-core/package.json')));
  const installedNext = JSON.parse(readFileSync(join(consumer, 'node_modules/activitylog-nextjs/package.json')));
  assert.equal(installedCore.version, expectedCoreVersion);
  assert.equal(installedNext.version, expectedNextVersion);
  console.log(`Prisma consumer smoke passed (core ${installedCore.version}, nextjs ${installedNext.version})`);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
