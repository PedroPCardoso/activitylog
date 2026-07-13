import type { ActivityStore, LogOptions } from 'activitylog-core';

export type ActivityLogModuleOptions = LogOptions & {
  store: ActivityStore;
};

export type ActivityLogFeatureOptions = LogOptions;
export type ActivityLogCallOptions = LogOptions;
