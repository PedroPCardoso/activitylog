import type { Activity, NewActivity } from './activity.types';
import type { ActivityFilter } from './query.types';

export interface TransactionRef {
  execute(sql: string, params?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface ActivityStore {
  persist(activities: readonly NewActivity[], ctx?: TransactionRef): Promise<void>;
  query(filter: ActivityFilter): Promise<readonly Activity[]>;
  prune(olderThan: Date, logName?: string): Promise<number>;
}
