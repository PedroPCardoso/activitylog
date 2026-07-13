import { DEFAULT_REDACT_FIELDS } from '../types/log-options.types';
import type { LogOptions, ResolvedLogOptions } from '../types/log-options.types';

const DEFAULT_LOG_NAME = 'default';

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
