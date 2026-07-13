import { describe, expect, it } from 'vitest';

import {
  InvalidActivityDateException,
  activityLogContextStorage,
  causerRef,
  createActivityLogger,
  subjectRef,
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

describe('ActivityLogger', () => {
  it('logs a description with application-generated UTC milliseconds', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({
      store,
      now: () => new Date('2026-07-12T10:20:30.123Z'),
    });

    await logger.activity().log('Look mum, I logged something');

    expect(persisted).toEqual([
      expect.objectContaining({
        logName: 'default',
        description: 'Look mum, I logged something',
        subject: null,
        causer: null,
        event: null,
        properties: {},
        batchUuid: null,
        createdAt: new Date('2026-07-12T10:20:30.123Z'),
      }),
    ]);
  });

  it('records a subject through performedOn and on', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await logger.activity().performedOn(subjectRef('Content', 7)).log('edited');
    await logger.activity().on(subjectRef('Content', 8)).log('edited again');

    expect(persisted.map((activity) => activity.subject)).toEqual([
      { type: 'Content', id: 7 },
      { type: 'Content', id: 8 },
    ]);
  });

  it('records a causer through causedBy and by', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await logger.activity().causedBy(causerRef('User', 'u1')).log('edited');
    await logger.activity().by(causerRef('User', 'u2')).log('edited again');

    expect(persisted.map((activity) => activity.causer)).toEqual([
      { type: 'User', id: 'u1' },
      { type: 'User', id: 'u2' },
    ]);
  });

  it('keeps the causer anonymous through causedByAnonymous and byAnonymous', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await logger.activity().causedBy(causerRef('User', 'u1')).causedByAnonymous().log('one');
    await logger.activity().causedBy(causerRef('User', 'u2')).byAnonymous().log('two');

    expect(persisted.map((activity) => activity.causer)).toEqual([null, null]);
  });

  it('merges custom properties and preserves builder immutability', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });
    const base = logger.activity('billing').withProperties({ plan: 'pro' });

    await base.withProperties({ region: 'BR' }).log('created');
    await base.log('unchanged');

    expect(persisted.map((activity) => activity.properties)).toEqual([
      { plan: 'pro', region: 'BR' },
      { plan: 'pro' },
    ]);
  });

  it('uses an explicit createdAt and event', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });
    const createdAt = new Date('2026-07-02T10:20:30.456Z');

    await logger.activity().createdAt(createdAt).event('verified').log('The user has verified content');
    createdAt.setUTCFullYear(2000);

    expect(persisted[0]).toEqual(
      expect.objectContaining({
        event: 'verified',
        createdAt: new Date('2026-07-02T10:20:30.456Z'),
      }),
    );
  });

  it('lets tap enrich known activity properties before persistence', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await logger
      .activity()
      .withProperties({ source: 'manual' })
      .tap((activity) => ({ ...activity, properties: { ...activity.properties, traceId: 'trace-1' } }))
      .log('edited');

    expect(persisted[0]?.properties).toEqual({ source: 'manual', traceId: 'trace-1' });
  });

  it('uses the current batch context and rejects invalid explicit dates', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await activityLogContextStorage.run({ batchUuid: 'batch-1' }, () => logger.activity().log('batched'));

    expect(persisted[0]?.batchUuid).toBe('batch-1');
    expect(() => logger.activity().createdAt(new Date('invalid'))).toThrow(InvalidActivityDateException);
  });
});
