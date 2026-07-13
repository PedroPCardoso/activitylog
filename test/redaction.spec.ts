import { describe, expect, it } from 'vitest';

import { createActivityLogger, type ActivityStore, type NewActivity } from 'activitylog-core';

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

describe('redaction pipeline', () => {
  it('redacts sensitive property names deeply and case-insensitively', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store });

    await logger
      .activity()
      .withProperties({
        password: 'plaintext',
        profile: { EMAIL: 'person@example.com', labels: [{ token: 'token-1' }] },
      })
      .log('created');

    expect(persisted[0]?.properties).toEqual({
      password: '[REDACTED]',
      profile: { EMAIL: '[REDACTED]', labels: [{ token: '[REDACTED]' }] },
    });
  });

  it('allows the redaction list to be overridden or disabled', async () => {
    const overridden = createObservingStore();
    const disabled = createObservingStore();

    await createActivityLogger({ store: overridden.store, logOptions: { redact: ['api_key'] } })
      .activity()
      .withProperties({ email: 'person@example.com', api_key: 'key-1' })
      .log('overridden');
    await createActivityLogger({ store: disabled.store, logOptions: { redact: false } })
      .activity()
      .withProperties({ password: 'plaintext' })
      .log('disabled');

    expect(overridden.persisted[0]?.properties).toEqual({ email: 'person@example.com', api_key: '[REDACTED]' });
    expect(disabled.persisted[0]?.properties).toEqual({ password: 'plaintext' });
  });

  it('runs beforePersist before redaction and cannot bypass it', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({
      store,
      logOptions: {
        beforePersist: (activity, context) => ({
          ...activity,
          description: `${context.event}:${activity.description}`,
          properties: { ...activity.properties, password: 'added-by-hook' },
        }),
      },
    });

    await logger.activity().event('updated').log('saved');

    expect(persisted).toEqual([
      expect.objectContaining({ description: 'updated:saved', properties: { password: '[REDACTED]' } }),
    ]);
  });

  it('does not persist explicitly empty diff snapshots when configured', async () => {
    const { persisted, store } = createObservingStore();
    const logger = createActivityLogger({ store, logOptions: { dontSubmitEmptyLogs: true } });

    await logger.activity().withProperties({ attributes: {}, old: {} }).event('updated').log('unchanged');
    await logger.activity().withProperties({ attributes: { name: 'new' }, old: {} }).event('updated').log('changed');

    expect(persisted).toEqual([expect.objectContaining({ description: 'changed' })]);
  });
});
