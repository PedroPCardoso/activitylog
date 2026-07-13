import { DEFAULT_REDACT_FIELDS } from '../types/log-options.types';
import type { LogOptions, ResolvedLogOptions } from '../types/log-options.types';

const DEFAULT_LOG_NAME = 'default';

export function mergeLogOptions(
  ...levels: readonly (LogOptions | undefined)[]
): LogOptions {
  let merged: Record<string, unknown> = {};

  for (const level of levels) {
    if (level === undefined) {
      continue;
    }

    merged = { ...merged, ...level };
    if (level.logOnly !== undefined) {
      delete merged.logExcept;
    }
    if (level.logExcept !== undefined) {
      delete merged.logOnly;
    }
  }

  return merged as LogOptions;
}

export function resolveLogOptions(options: LogOptions = {}): ResolvedLogOptions {
  return {
    logOnlyDirty: options.logOnlyDirty ?? false,
    dontSubmitEmptyLogs: options.dontSubmitEmptyLogs ?? false,
    useLogName: options.useLogName ?? DEFAULT_LOG_NAME,
    descriptionForEvent: options.descriptionForEvent,
    beforePersist: options.beforePersist,
    lockForDiff: options.lockForDiff ?? false,
    tableName: options.tableName,
    store: options.store,
    logOnly: options.logOnly,
    logExcept: options.logExcept,
    redact: options.redact ?? DEFAULT_REDACT_FIELDS,
  };
}
