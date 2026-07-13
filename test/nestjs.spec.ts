import 'reflect-metadata';

import { Inject, Injectable, Module, type DynamicModule, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import type {
  ActivityLogBuilder,
  ActivityStore,
  LogOptions,
  NewActivity,
} from 'activitylog-core';

interface ActivityLogServiceLike {
  activity(logName?: string, options?: LogOptions): ActivityLogBuilder;
}

interface ActivityLogModuleLike {
  forRoot(options: LogOptions & { store: ActivityStore }): DynamicModule;
  forFeature(options: LogOptions): DynamicModule;
}

interface NestActivityLogExports {
  ActivityLogModule?: ActivityLogModuleLike;
  ActivityLogService?: Type<ActivityLogServiceLike>;
}

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

async function nestExports(): Promise<Required<NestActivityLogExports>> {
  const exports = (await import('activitylog-nestjs')) as NestActivityLogExports;

  expect(exports.ActivityLogModule).toBeDefined();
  expect(exports.ActivityLogService).toBeDefined();

  return exports as Required<NestActivityLogExports>;
}

describe('ActivityLogModule', () => {
  it('resolves default and root log names through an injectable facade', async () => {
    const { ActivityLogModule, ActivityLogService } = await nestExports();
    const defaultObserved = createObservingStore();
    const defaultModule = await Test.createTestingModule({
      imports: [ActivityLogModule.forRoot({ store: defaultObserved.store })],
    }).compile();
    const defaultService = defaultModule.get(ActivityLogService);

    await defaultService.activity().log('default');

    const rootObserved = createObservingStore();
    const rootModule = await Test.createTestingModule({
      imports: [
        ActivityLogModule.forRoot({
          store: rootObserved.store,
          useLogName: 'root',
        }),
      ],
    }).compile();
    const rootService = rootModule.get(ActivityLogService);

    await rootService.activity().log('root');

    expect(defaultObserved.persisted[0]?.logName).toBe('default');
    expect(rootObserved.persisted[0]?.logName).toBe('root');

    await defaultModule.close();
    await rootModule.close();
  });

  it('applies feature options and lets call options win', async () => {
    const { ActivityLogModule, ActivityLogService } = await nestExports();
    const observed = createObservingStore();

    @Injectable()
    class FeatureProbe {
      constructor(
        @Inject(ActivityLogService)
        readonly activityLog: ActivityLogServiceLike,
      ) {}
    }

    @Module({
      imports: [ActivityLogModule.forFeature({ useLogName: 'feature' })],
      providers: [FeatureProbe],
      exports: [FeatureProbe],
    })
    class FeatureModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ActivityLogModule.forRoot({
          store: observed.store,
          useLogName: 'root',
        }),
        FeatureModule,
      ],
    }).compile();
    const probe = moduleRef.get(FeatureProbe);

    await probe.activityLog.activity().log('feature');
    await probe.activityLog
      .activity(undefined, { useLogName: 'call' })
      .log('call');

    expect(observed.persisted.map((activity) => activity.logName)).toEqual([
      'feature',
      'call',
    ]);

    await moduleRef.close();
  });
});
