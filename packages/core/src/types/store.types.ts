import type { Activity, NewActivity } from './activity.types';
import type { ActivityFilter } from './query.types';
import type { SqlExecutor } from '../sql/datasource.types';

export interface TransactionRef extends SqlExecutor {}

export interface ActivityStore {
  persist(activities: readonly NewActivity[], ctx?: TransactionRef): Promise<void>;
  query(filter: ActivityFilter): Promise<readonly Activity[]>;
  prune(olderThan: Date, logName?: string): Promise<number>;
}
