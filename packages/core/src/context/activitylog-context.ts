import { AsyncLocalStorage } from 'node:async_hooks';

import type { CauserRef } from '../types/activity.types';

export interface ActivityLogContext {
  causer?: CauserRef | null;
  causerResolver?: () => CauserRef | null | undefined;
  batchUuid?: string;
  withoutLogging?: boolean;
}

// D5 guard: this singleton must come from activitylog-core and be external in
// leaf package bundles. Duplicating it would silently drop causer/batch context.
export const activityLogContextStorage = new AsyncLocalStorage<ActivityLogContext>();

export function getActivityLogContext(): ActivityLogContext | undefined {
  return activityLogContextStorage.getStore();
}
