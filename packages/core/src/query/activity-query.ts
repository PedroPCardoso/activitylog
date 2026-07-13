import type { Activity, ActivityEvent, ActivityId } from '../types/activity.types';
import type {
  ActivityCursor,
  ActivityFilter,
  ActivityPage,
  ActivityQuery,
  PropertyFilter,
} from '../types/query.types';
import type { ActivityStore } from '../types/store.types';

export function activityQuery<TActivity extends Activity = Activity>(store: ActivityStore): ActivityQuery<TActivity> {
  return new ActivityQueryBuilder<TActivity>(store, {});
}

class ActivityQueryBuilder<TActivity extends Activity> implements ActivityQuery<TActivity> {
  constructor(
    private readonly store: ActivityStore,
    private readonly filter: ActivityFilter,
  ) {}

  inLog(logName: string): ActivityQuery<TActivity> {
    return this.copy({ logName });
  }

  forSubject(type: string, id?: ActivityId): ActivityQuery<TActivity> {
    return this.copy({ subject: { type, id } });
  }

  causedBy(type: string, id?: ActivityId): ActivityQuery<TActivity> {
    return this.copy({ causer: { type, id } });
  }

  forEvent(event: ActivityEvent): ActivityQuery<TActivity> {
    return this.copy({ event });
  }

  forBatch(batchUuid: string): ActivityQuery<TActivity> {
    return this.copy({ batchUuid });
  }

  between(from: Date, to: Date): ActivityQuery<TActivity> {
    return this.copy({ from, to });
  }

  withAggregates(include = true): ActivityQuery<TActivity> {
    return this.copy({ includeAggregates: include });
  }

  whereProperty(path: string, value: unknown): ActivityQuery<TActivity>;
  whereProperty(filter: PropertyFilter): ActivityQuery<TActivity>;
  whereProperty(pathOrFilter: string | PropertyFilter, value?: unknown): ActivityQuery<TActivity> {
    const property =
      typeof pathOrFilter === 'string'
        ? { path: pathOrFilter, operator: '=' as const, value }
        : pathOrFilter;
    return this.copy({ properties: [...(this.filter.properties ?? []), property] });
  }

  async paginate(limit: number, cursor?: ActivityCursor): Promise<ActivityPage<TActivity>> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('activitylog: pagination limit must be a positive integer');
    }

    const results = (await this.store.query({
      ...this.filter,
      cursor,
      limit: limit + 1,
    })) as readonly TActivity[];
    const items = results.slice(0, limit);
    const last = items.at(-1);

    return {
      items,
      nextCursor: results.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  private copy(change: Partial<ActivityFilter>): ActivityQuery<TActivity> {
    return new ActivityQueryBuilder(this.store, { ...this.filter, ...change });
  }
}
