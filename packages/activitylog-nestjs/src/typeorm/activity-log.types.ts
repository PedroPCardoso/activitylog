import type { ActivityStore, LogOptions } from 'activitylog-core';

export interface ActivityLogSubscriberOptions {
  store: ActivityStore;
  logOptions?: LogOptions;
  now?: () => Date;
}
