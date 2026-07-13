import {
  causerRef,
  type ActivityId,
  type CauserRef,
} from 'activitylog-core';

import type { ActivityLogCauserResolver } from './activity-log.types';

export interface ActivityLogRequest {
  user?: unknown;
}

export function resolveRequestCauser(
  request: ActivityLogRequest,
  resolver?: ActivityLogCauserResolver,
): CauserRef | null {
  if (resolver !== undefined) {
    return resolver(request) ?? null;
  }

  const user = request.user;
  if (!isRecord(user) || !isActivityId(user.id)) {
    return null;
  }

  const explicitType =
    typeof user.type === 'string' && user.type.length > 0
      ? user.type
      : undefined;
  const constructorType =
    user.constructor !== Object && user.constructor.name.length > 0
      ? user.constructor.name
      : undefined;

  return causerRef(explicitType ?? constructorType ?? 'User', user.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isActivityId(value: unknown): value is ActivityId {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  );
}
