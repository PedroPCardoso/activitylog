import { InvalidActivityDateException } from '../exceptions/invalid-activity-date.exception';
import { getActivityLogContext } from '../context/activitylog-context';
import { isActivityLoggingEnabled } from '../context/activitylog-context.helpers';
import { resolveLogOptions } from '../options/resolve-log-options';
import { redactActivity } from '../redaction/redact-activity';
import { createActivityTimestamp } from '../types/time.types';
import type {
  ActivityEvent,
  ActivityProperties,
  ActivitySubjectRef,
  CauserRef,
  NewActivity,
} from '../types/activity.types';
import type { ActivityStore } from '../types/store.types';
import type { LogOptions, ResolvedLogOptions } from '../types/log-options.types';

const DEFAULT_LOG_NAME = 'default';

export interface ActivityLoggerOptions {
  store: ActivityStore;
  logName?: string;
  now?: () => Date;
  logOptions?: LogOptions;
}

export type ActivityTap = (activity: NewActivity) => void | NewActivity;

interface ActivityBuilderState {
  logName: string;
  subject: ActivitySubjectRef | null;
  causer?: CauserRef | null;
  properties: ActivityProperties;
  event: ActivityEvent | null;
  createdAt?: Date;
  taps: readonly ActivityTap[];
}

export function createActivityLogger(options: ActivityLoggerOptions): ActivityLogger {
  return new ActivityLogger(options);
}

export class ActivityLogger {
  private readonly defaultLogName: string;
  private readonly now: () => Date;
  private readonly logOptions: ResolvedLogOptions;

  constructor(private readonly options: ActivityLoggerOptions) {
    this.logOptions = resolveLogOptions(options.logOptions);
    this.defaultLogName = options.logName ?? this.logOptions.useLogName ?? DEFAULT_LOG_NAME;
    this.now = options.now ?? (() => new Date());
  }

  activity(logName = this.defaultLogName): ActivityLogBuilder {
    return new ActivityLogBuilder(this.options.store, this.now, this.logOptions, {
      logName,
      subject: null,
      properties: {},
      event: null,
      taps: [],
    });
  }
}

export class ActivityLogBuilder {
  constructor(
    private readonly store: ActivityStore,
    private readonly now: () => Date,
    private readonly logOptions: ResolvedLogOptions,
    private readonly state: ActivityBuilderState,
  ) {}

  performedOn(subject: ActivitySubjectRef): ActivityLogBuilder {
    return this.copy({ subject: copyRef(subject) });
  }

  on(subject: ActivitySubjectRef): ActivityLogBuilder {
    return this.performedOn(subject);
  }

  causedBy(causer: CauserRef): ActivityLogBuilder {
    return this.copy({ causer: copyRef(causer) });
  }

  by(causer: CauserRef): ActivityLogBuilder {
    return this.causedBy(causer);
  }

  causedByAnonymous(): ActivityLogBuilder {
    return this.copy({ causer: null });
  }

  byAnonymous(): ActivityLogBuilder {
    return this.causedByAnonymous();
  }

  withProperties(properties: ActivityProperties): ActivityLogBuilder {
    return this.copy({ properties: { ...this.state.properties, ...properties } });
  }

  createdAt(createdAt: Date): ActivityLogBuilder {
    assertValidDate(createdAt);
    return this.copy({ createdAt: new Date(createdAt.getTime()) });
  }

  event(event: ActivityEvent): ActivityLogBuilder {
    return this.copy({ event });
  }

  tap(tap: ActivityTap): ActivityLogBuilder {
    return this.copy({ taps: [...this.state.taps, tap] });
  }

  async log(description: string): Promise<void> {
    const context = getActivityLogContext();
    if (!isActivityLoggingEnabled() || context?.withoutLogging === true) {
      return;
    }

    const causer =
      this.state.causer !== undefined
        ? this.state.causer
        : context?.causer !== undefined
          ? context.causer
          : context?.causerResolver?.() ?? null;
    let activity: NewActivity = {
      logName: this.state.logName,
      description,
      subject: this.state.subject === null ? null : copyRef(this.state.subject),
      causer: causer === null ? null : copyRef(causer),
      properties: { ...this.state.properties },
      event: this.state.event,
      batchUuid: context?.batchUuid ?? null,
      createdAt: this.timestamp(),
    };

    for (const tap of this.state.taps) {
      activity = tap(activity) ?? activity;
    }

    if (this.logOptions.beforePersist) {
      activity =
        (await this.logOptions.beforePersist(activity, {
          event: activity.event ?? 'created',
          subject: activity.subject,
          options: this.logOptions,
        })) ?? activity;
    }

    activity = redactActivity(activity, this.logOptions.redact);

    if (this.logOptions.dontSubmitEmptyLogs && hasEmptyDiff(activity)) {
      return;
    }

    await this.store.persist([activity]);
  }

  private copy(change: Partial<ActivityBuilderState>): ActivityLogBuilder {
    return new ActivityLogBuilder(this.store, this.now, this.logOptions, {
      ...this.state,
      ...change,
      properties: change.properties ?? this.state.properties,
      taps: change.taps ?? this.state.taps,
    });
  }

  private timestamp(): Date {
    const timestamp = this.state.createdAt ?? createActivityTimestamp(this.now());
    assertValidDate(timestamp);
    return new Date(timestamp.getTime());
  }
}

function hasEmptyDiff(activity: NewActivity): boolean {
  const { attributes, old } = activity.properties;
  return isEmptyRecord(attributes) && isEmptyRecord(old);
}

function isEmptyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

function assertValidDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidActivityDateException();
  }
}

function copyRef<Ref extends ActivitySubjectRef | CauserRef>(ref: Ref): Ref {
  return { ...ref };
}
