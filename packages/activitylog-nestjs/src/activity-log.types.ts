import type { ActivityStore, CauserRef, LogOptions } from 'activitylog-core';

export type ActivityLogCauserResolver = (
  request: any,
) => CauserRef | null | undefined;

export type ActivityLogModuleOptions = LogOptions & {
  store: ActivityStore;
  causerResolver?: ActivityLogCauserResolver;
};

export type ActivityLogFeatureOptions = LogOptions;
export type ActivityLogCallOptions = LogOptions;
