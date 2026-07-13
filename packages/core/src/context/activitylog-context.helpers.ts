import { randomUUID } from 'node:crypto';

import { activityLogContextStorage, getActivityLogContext } from './activitylog-context';
import type { CauserRef } from '../types/activity.types';

export interface SerializedActivityLogContext {
  causer?: CauserRef | null;
  batchUuid?: string;
}

let loggingEnabled = true;

export function runWithContext<T>(context: SerializedActivityLogContext | undefined, callback: () => T): T {
  return activityLogContextStorage.run(
    {
      causer: context?.causer === undefined || context.causer === null ? context?.causer : { ...context.causer },
      batchUuid: context?.batchUuid,
    },
    callback,
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

export function withBatch<T>(callback: () => T): T {
  const context = getActivityLogContext();
  return activityLogContextStorage.run(
    {
      ...context,
      batchUuid: context?.batchUuid ?? randomUUID(),
    },
    callback,
  );
}

export function withoutLogging<T>(callback: () => T): T {
  return activityLogContextStorage.run(
    {
      ...getActivityLogContext(),
      withoutLogging: true,
    },
    callback,
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
