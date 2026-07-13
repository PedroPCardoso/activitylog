import { randomUUID } from 'node:crypto';

import { activityLogContextStorage, getActivityLogContext } from './activitylog-context';
import type { CauserRef } from '../types/activity.types';

export interface SerializedActivityLogContext {
  causer?: CauserRef | null;
  batchUuid?: string;
}

let loggingEnabled = true;

type ContextualResult<T> = T extends PromiseLike<infer Value> ? Promise<Awaited<Value>> : T;

export function runWithContext<T>(
  context: SerializedActivityLogContext | undefined,
  callback: () => T,
): ContextualResult<T> {
  return activityLogContextStorage.run(
    {
      causer: context?.causer === undefined || context.causer === null ? context?.causer : { ...context.causer },
      batchUuid: context?.batchUuid,
    },
    () => retainThenable(callback()),
  );
}

export function serializeContext(): SerializedActivityLogContext | undefined {
  const context = getActivityLogContext();

  if (context === undefined) {
    return undefined;
  }

  return {
    causer: context.causer === undefined || context.causer === null ? context.causer : { ...context.causer },
    batchUuid: context.batchUuid,
  };
}

export function withBatch<T>(callback: () => T): ContextualResult<T> {
  const context = getActivityLogContext();
  return activityLogContextStorage.run(
    {
      ...context,
      batchUuid: context?.batchUuid ?? randomUUID(),
    },
    () => retainThenable(callback()),
  );
}

export function withoutLogging<T>(callback: () => T): ContextualResult<T> {
  return activityLogContextStorage.run(
    {
      ...getActivityLogContext(),
      withoutLogging: true,
    },
    () => retainThenable(callback()),
  );
}

export function disableLogging(): void {
  loggingEnabled = false;
}

export function enableLogging(): void {
  loggingEnabled = true;
}

export function isActivityLoggingEnabled(): boolean {
  return loggingEnabled;
}

function retainThenable<T>(value: T): ContextualResult<T> {
  return (isPromiseLike(value) ? Promise.resolve(value) : value) as ContextualResult<T>;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}
