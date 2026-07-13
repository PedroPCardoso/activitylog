import { InvalidActivityDateException } from '../exceptions/invalid-activity-date.exception';
import { getActivityLogContext } from '../context/activitylog-context';
import { createActivityTimestamp } from '../types/time.types';
import type {
  ActivityEvent,
  ActivityProperties,
  CauserRef,
  NewActivity,
  SubjectRef,
} from '../types/activity.types';
import type { ActivityStore } from '../types/store.types';

const DEFAULT_LOG_NAME = 'default';

export interface ActivityLoggerOptions {
  store: ActivityStore;
  logName?: string;
  now?: () => Date;
}

export type ActivityTap = (activity: NewActivity) => void | NewActivity;

interface ActivityBuilderState {
  logName: string;
  subject: SubjectRef | null;
  causer: CauserRef | null;
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

  constructor(private readonly options: ActivityLoggerOptions) {
    this.defaultLogName = options.logName ?? DEFAULT_LOG_NAME;
    this.now = options.now ?? (() => new Date());
  }

  activity(logName = this.defaultLogName): ActivityLogBuilder {
    return new ActivityLogBuilder(this.options.store, this.now, {
      logName,
      subject: null,
      causer: null,
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
    private readonly state: ActivityBuilderState,
  ) {}

  performedOn(subject: SubjectRef): ActivityLogBuilder {
    return this.copy({ subject: copyRef(subject) });
  }

  on(subject: SubjectRef): ActivityLogBuilder {
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
    let activity: NewActivity = {
      logName: this.state.logName,
      description,
      subject: this.state.subject === null ? null : copyRef(this.state.subject),
      causer: this.state.causer === null ? null : copyRef(this.state.causer),
      properties: { ...this.state.properties },
      event: this.state.event,
      batchUuid: context?.batchUuid ?? null,
      createdAt: this.timestamp(),
    };

    for (const tap of this.state.taps) {
      activity = tap(activity) ?? activity;
    }

    await this.store.persist([activity]);
  }

  private copy(change: Partial<ActivityBuilderState>): ActivityLogBuilder {
    return new ActivityLogBuilder(this.store, this.now, {
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

function assertValidDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidActivityDateException();
  }
}

function copyRef<Ref extends SubjectRef | CauserRef>(ref: Ref): Ref {
  return { ...ref };
}
