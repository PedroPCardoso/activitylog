import type { ActivityEvent, ActivitySubjectRef, NewActivity } from './activity.types';
import type { ActivityStore } from './store.types';

export type MaybePromise<T> = T | Promise<T>;

export interface DiffSnapshot {
  attributes: Record<string, unknown>;
  old: Record<string, unknown>;
}

export interface DescriptionContext {
  event: ActivityEvent;
  subject: ActivitySubjectRef | null;
  diff: DiffSnapshot;
}

export interface BeforePersistContext {
  event: ActivityEvent;
  subject: ActivitySubjectRef | null;
  options: ResolvedLogOptions;
}

type FieldSelection =
  | {
      logOnly?: readonly string[];
      logExcept?: never;
    }
  | {
      logOnly?: never;
      logExcept?: readonly string[];
    }
  | {
      logOnly?: never;
      logExcept?: never;
    };

interface BaseLogOptions {
  logOnlyDirty?: boolean;
  dontSubmitEmptyLogs?: boolean;
  useLogName?: string;
  descriptionForEvent?: (context: DescriptionContext) => string;
  redact?: readonly string[] | false;
  beforePersist?: (activity: NewActivity, context: BeforePersistContext) => MaybePromise<void | NewActivity>;
  lockForDiff?: boolean;
  tableName?: string;
  store?: ActivityStore;
}

export type LogOptions = BaseLogOptions & FieldSelection;

export type ResolvedLogOptions = Required<
  Pick<BaseLogOptions, 'logOnlyDirty' | 'dontSubmitEmptyLogs' | 'useLogName' | 'lockForDiff'>
> &
  Pick<BaseLogOptions, 'descriptionForEvent' | 'beforePersist' | 'store' | 'tableName'> & {
    logOnly?: readonly string[];
    logExcept?: readonly string[];
    redact: readonly string[] | false;
  };

export const DEFAULT_REDACT_FIELDS = [
  'password',
  'pass',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'authorization',
  'email',
] as const;
