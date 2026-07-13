import { afterEach, describe, expect, it } from 'vitest';

import {
  ACTIVITY_LOG_MIGRATIONS,
  SqlExecutorStore,
  activityQuery,
  createActivityLogger,
  type SupportedDialect,
} from 'activitylog-core';

import {
  availableExternalDialects,
  createExternalSqlDataSource,
  type ExternalSqlDataSource,
} from './helpers/external-sql-executors';

describe('activity log migrations', () => {
  it('publish all required columns and indexes for every dialect', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql'] as const) {
      const migration = ACTIVITY_LOG_MIGRATIONS[dialect];

      expect(migration).toContain('created_at');
      expect(migration).toContain('subject_type');
      expect(migration).toContain('causer_type');
      expect(migration).toContain('log_name');
      expect(migration).toContain('idx_activity_log_subject');
      expect(migration).toContain('idx_activity_log_causer');
    }
  });
});

for (const dialect of availableExternalDialects()) {
  describe(`${dialect} activity log integration`, () => {
    let dataSource: ExternalSqlDataSource | undefined;

    afterEach(async () => {
      await dataSource?.close();
      dataSource = undefined;
    });

    it('persists and reads a manual activity through the reference migration', async () => {
      dataSource = await createExternalSqlDataSource(dialect as Exclude<SupportedDialect, 'sqlite'>);
      await dataSource.execute('DROP TABLE IF EXISTS activity_log');
      await dataSource.execute(ACTIVITY_LOG_MIGRATIONS[dialect]);

      const store = new SqlExecutorStore({ dataSource });
      await createActivityLogger({ store })
        .activity('billing')
        .event('created')
        .withProperties({ plan: 'pro' })
        .log('created');

      await expect(activityQuery(store).inLog('billing').whereProperty('plan', 'pro').paginate(10)).resolves.toEqual(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              logName: 'billing',
              event: 'created',
              properties: { plan: 'pro' },
            }),
          ],
        }),
      );
    });
  });
}
