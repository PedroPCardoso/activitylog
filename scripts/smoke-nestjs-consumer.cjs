const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const consumer = mkdtempSync(join(tmpdir(), 'activitylog-nestjs-consumer-'));

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
  const expectedNestVersion = JSON.parse(
    readFileSync(resolve(root, 'packages/activitylog-nestjs/package.json')),
  ).version;
  const coreTarball = pack('packages/core');
  const nestTarball = pack('packages/activitylog-nestjs');

  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'activitylog-nestjs-consumer-smoke',
    version: '1.0.0',
    private: true,
    type: 'commonjs',
  }, null, 2));

  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    coreTarball,
    nestTarball,
    '@nestjs/common@11.1.28',
    '@nestjs/core@11.1.28',
    'reflect-metadata@0.2.2',
    'rxjs@7.8.2',
    'typeorm@0.3.30',
  ]);

  writeFileSync(join(consumer, 'app.cjs'), `
require('reflect-metadata');
const assert = require('node:assert/strict');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const core = require('activitylog-core');
const nestjs = require('activitylog-nestjs');
const typeorm = require('activitylog-nestjs/typeorm');
const { runWithContext } = core;
const { ActivityLogModule, ActivityLogService } = nestjs;

assert.equal(typeof typeorm.LogsActivity, 'function');
assert.equal(typeof typeorm.ActivityLogSubscriber, 'function');
assert.equal(typeof typeorm.auditedUpdate, 'function');
assert.equal(nestjs.createActivityLogger, core.createActivityLogger);
assert.equal(typeorm.createActivityLogger, core.createActivityLogger);

const persisted = [];
const store = {
  persist: async (activities) => persisted.push(...activities),
  query: async () => [],
  prune: async () => 0,
};

class ConsumerModule {}
Module({ imports: [ActivityLogModule.forRoot({ store })] })(ConsumerModule);

(async () => {
  const app = await NestFactory.createApplicationContext(ConsumerModule, { logger: false });
  try {
    const activityLog = app.get(ActivityLogService);
    await runWithContext({ causer: { type: 'User', id: 'consumer-smoke' } }, () =>
      activityLog.activity('consumer').event('smoke').log('Installed package works'),
    );

    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].logName, 'consumer');
    assert.equal(persisted[0].event, 'smoke');
    assert.deepEqual(persisted[0].causer, { type: 'User', id: 'consumer-smoke' });
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`);

  run(process.execPath, ['app.cjs']);

  const installedCore = JSON.parse(readFileSync(join(consumer, 'node_modules/activitylog-core/package.json')));
  const installedNest = JSON.parse(readFileSync(join(consumer, 'node_modules/activitylog-nestjs/package.json')));
  assert.equal(installedCore.version, expectedCoreVersion);
  assert.equal(installedNest.version, expectedNestVersion);
  console.log(`NestJS consumer smoke passed (core ${installedCore.version}, nestjs ${installedNest.version})`);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
