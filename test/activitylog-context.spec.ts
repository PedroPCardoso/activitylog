import { describe, expect, it } from 'vitest';

import {
  activityLogContextStorage,
  causerRef,
  createActivityLogger,
  disableLogging,
  enableLogging,
  runWithContext,
  serializeContext,
  withBatch,
  withoutLogging,
  type ActivityStore,
  type NewActivity,
} from 'activitylog-core';

function createObservingStore(): { store: ActivityStore; persisted: NewActivity[] } {
  const persisted: NewActivity[] = [];

  return {
    persisted,
    store: {
      persist: async (activities) => {
        persisted.push(...activities);
      },
      query: async () => [],
      prune: async () => 0,
    },
  };
}

describe('activity log context', () => {
  it('resolves a causer from context only when the builder omits causedBy', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await runWithContext({ causer: causerRef('User', 'u1') }, async () => {
      await logger.activity().log('context causer');
      await logger.activity().causedByAnonymous().log('anonymous');
    });

    expect(persisted.map((activity) => activity.causer)).toEqual([
      { type: 'User', id: 'u1' },
      null,
    ]);
  });

  it('resolves a lazy causer at log time', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });
    const request: { user?: { id: string } } = {};

    await activityLogContextStorage.run(
      {
        causerResolver: () => (request.user ? causerRef('User', request.user.id) : null),
      },
      async () => {
        request.user = { id: 'u1' };
        await logger.activity().log('lazy');
      },
    );

    expect(persisted[0]?.causer).toEqual({ type: 'User', id: 'u1' });
  });

  it('does not invoke a lazy resolver when the builder has an explicit causer', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await activityLogContextStorage.run(
      {
        causerResolver: () => {
          throw new Error('resolver must not run');
        },
      },
      async () => {
        await logger
          .activity()
          .causedBy(causerRef('Admin', 'a1'))
          .log('explicit');
        await logger.activity().causedByAnonymous().log('anonymous');
      },
    );

    expect(persisted.map((activity) => activity.causer)).toEqual([
      { type: 'Admin', id: 'a1' },
      null,
    ]);
  });

  it('propagates context across Promise.all and setTimeout', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await runWithContext({ causer: causerRef('User', 'u1') }, async () => {
      await Promise.all([
        logger.activity().log('parallel'),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            void logger.activity().log('timer').then(resolve);
          }, 0);
        }),
      ]);
    });

    expect(persisted.map((activity) => activity.causer)).toEqual([
      { type: 'User', id: 'u1' },
      { type: 'User', id: 'u1' },
    ]);
  });

  it('shares nested batches and restores the outer scope afterward', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await withBatch(async () => {
      await logger.activity().log('outer');
      await withBatch(async () => logger.activity().log('inner'));
    });
    await logger.activity().log('outside');

    expect(persisted[0]?.batchUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(persisted[1]?.batchUuid).toBe(persisted[0]?.batchUuid);
    expect(persisted[2]?.batchUuid).toBeNull();
  });

  it('suppresses logging locally and through the global switch', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await withoutLogging(() => logger.activity().log('suppressed'));
    disableLogging();
    await logger.activity().log('globally suppressed');
    enableLogging();
    await logger.activity().log('enabled');

    expect(persisted).toEqual([expect.objectContaining({ description: 'enabled' })]);
  });

  it('serializes causer and batch across a simulated job boundary', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });
    const serialized = await runWithContext(
      { causer: causerRef('User', 'u1'), batchUuid: 'batch-1' },
      () => serializeContext(),
    );

    await runWithContext(serialized, () => logger.activity().log('job'));
    await logger.activity().log('system');

    expect(persisted).toEqual([
      expect.objectContaining({ causer: { type: 'User', id: 'u1' }, batchUuid: 'batch-1' }),
      expect.objectContaining({ causer: null, batchUuid: null }),
    ]);
  });

  it('serializes missing and explicitly anonymous contexts without inventing a causer', () => {
    expect(serializeContext()).toBeUndefined();
    expect(
      runWithContext({ causer: null }, () => serializeContext()),
    ).toEqual({ causer: null, batchUuid: undefined });
  });
});
