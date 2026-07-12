import type { Activity, ActivityEvent, ActivityId } from './activity.types';

export type ActivitySortDirection = 'asc' | 'desc';

export interface ActivityCursor {
  createdAt: Date;
  id: ActivityId;
}

export interface ActivityPage<TActivity extends Activity = Activity> {
  items: readonly TActivity[];
  nextCursor: ActivityCursor | null;
}

export interface PropertyFilter {
  path: string;
  operator: '=' | '!=' | 'contains' | 'exists';
  value?: unknown;
}

export interface ActivityFilter {
  logName?: string;
  subject?: {
    type: string;
    id?: ActivityId;
  };
  causer?: {
    type: string;
    id?: ActivityId;
  };
  event?: ActivityEvent;
  batchUuid?: string;
  from?: Date;
  to?: Date;
  includeAggregates?: boolean;
  properties?: readonly PropertyFilter[];
  limit?: number;
  cursor?: ActivityCursor;
  sort?: ActivitySortDirection;
}

export interface ActivityQuery<TActivity extends Activity = Activity> {
  inLog(logName: string): ActivityQuery<TActivity>;
  forSubject(type: string, id?: ActivityId): ActivityQuery<TActivity>;
  causedBy(type: string, id?: ActivityId): ActivityQuery<TActivity>;
  forEvent(event: ActivityEvent): ActivityQuery<TActivity>;
  forBatch(batchUuid: string): ActivityQuery<TActivity>;
  between(from: Date, to: Date): ActivityQuery<TActivity>;
  withAggregates(include?: boolean): ActivityQuery<TActivity>;
  whereProperty(path: string, value: unknown): ActivityQuery<TActivity>;
  whereProperty(filter: PropertyFilter): ActivityQuery<TActivity>;
  paginate(limit: number, cursor?: ActivityCursor): Promise<ActivityPage<TActivity>>;
}
