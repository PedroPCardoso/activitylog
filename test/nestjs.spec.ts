import 'reflect-metadata';

import {
  Inject,
  Injectable,
  Module,
  type CallHandler,
  type DynamicModule,
  type ExecutionContext,
  type Type,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { defer, firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type {
  ActivityLogBuilder,
  ActivityStore,
  LogOptions,
  NewActivity,
} from 'activitylog-core';
import { resolveRequestCauser } from 'activitylog-nestjs';

interface ActivityLogServiceLike {
  activity(logName?: string, options?: LogOptions): ActivityLogBuilder;
}

interface ActivityLogModuleLike {
  forRoot(
    options: LogOptions & {
      store: ActivityStore;
      causerResolver?: (request: ActivityLogRequestLike) =>
        | { type: string; id: string | number | bigint }
        | null
        | undefined;
    },
  ): DynamicModule;
  forFeature(options: LogOptions): DynamicModule;
}

interface ActivityLogRequestLike {
  user?: {
    id: string | number | bigint;
    type?: string;
  } | null;
}

interface ActivityLogMiddlewareLike {
  use(
    request: ActivityLogRequestLike,
    response: unknown,
    next: (error?: unknown) => void,
  ): void;
}

interface ActivityLogInterceptorLike {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> | Promise<Observable<unknown>>;
}

interface NestActivityLogExports {
  ActivityLogModule?: ActivityLogModuleLike;
  ActivityLogService?: Type<ActivityLogServiceLike>;
  ActivityLogMiddleware?: Type<ActivityLogMiddlewareLike>;
  ActivityLogInterceptor?: Type<ActivityLogInterceptorLike>;
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

async function httpExports(): Promise<
  Required<
    Pick<
      NestActivityLogExports,
      'ActivityLogInterceptor' | 'ActivityLogMiddleware'
    >
  >
> {
  const exports = (await import('activitylog-nestjs')) as NestActivityLogExports;

  expect(exports.ActivityLogMiddleware).toBeDefined();
  expect(exports.ActivityLogInterceptor).toBeDefined();

  return exports as Required<
    Pick<
      NestActivityLogExports,
      'ActivityLogInterceptor' | 'ActivityLogMiddleware'
    >
  >;
}

describe('ActivityLogModule', () => {
  it('resolves null-prototype request users with an id', () => {
    const user = Object.assign(Object.create(null) as object, { id: 'u2' });

    expect(resolveRequestCauser({ user })).toEqual({
      type: 'User',
      id: 'u2',
    });
  });

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

  it('opens middleware context before resolving request.user lazily', async () => {
    const { ActivityLogModule, ActivityLogService } = await nestExports();
    const { ActivityLogMiddleware } = await httpExports();
    const observed = createObservingStore();
    const moduleRef = await Test.createTestingModule({
      imports: [ActivityLogModule.forRoot({ store: observed.store })],
    }).compile();
    const middleware = moduleRef.get(ActivityLogMiddleware);
    const service = moduleRef.get(ActivityLogService);
    const request: ActivityLogRequestLike = {};
    let logging!: Promise<void>;

    middleware.use(request, {}, () => {
      request.user = { id: 'u1' };
      logging = service.activity().log('from middleware');
    });
    await logging;

    expect(observed.persisted[0]?.causer).toEqual({
      type: 'User',
      id: 'u1',
    });

    await moduleRef.close();
  });

  it('runs deferred interceptor handlers inside the request context', async () => {
    const { ActivityLogModule, ActivityLogService } = await nestExports();
    const { ActivityLogInterceptor } = await httpExports();
    const observed = createObservingStore();
    const moduleRef = await Test.createTestingModule({
      imports: [ActivityLogModule.forRoot({ store: observed.store })],
    }).compile();
    const interceptor = moduleRef.get(ActivityLogInterceptor);
    const service = moduleRef.get(ActivityLogService);
    const request: ActivityLogRequestLike = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
    const next: CallHandler = {
      handle: () =>
        defer(async () => {
          request.user = { id: 7, type: 'Admin' };
          await service.activity().log('from interceptor');
          return 'done';
        }),
    };

    const stream = await interceptor.intercept(context, next);
    await firstValueFrom(stream);

    expect(observed.persisted[0]?.causer).toEqual({
      type: 'Admin',
      id: 7,
    });

    await moduleRef.close();
  });
});
