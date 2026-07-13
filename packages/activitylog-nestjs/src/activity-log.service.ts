import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  createActivityLogger,
  mergeLogOptions,
  type ActivityLogBuilder,
} from 'activitylog-core';

import {
  ACTIVITYLOG_FEATURE_OPTIONS,
  ACTIVITYLOG_ROOT_OPTIONS,
} from './activity-log.constants';
import type {
  ActivityLogCallOptions,
  ActivityLogFeatureOptions,
  ActivityLogModuleOptions,
} from './activity-log.types';

@Injectable()
export class ActivityLogService {
  constructor(
    @Inject(ACTIVITYLOG_ROOT_OPTIONS)
    private readonly rootOptions: ActivityLogModuleOptions,
    @Optional()
    @Inject(ACTIVITYLOG_FEATURE_OPTIONS)
    private readonly featureOptions?: ActivityLogFeatureOptions,
  ) {}

  activity(
    logName?: string,
    options?: ActivityLogCallOptions,
  ): ActivityLogBuilder {
    const mergedOptions = mergeLogOptions(
      this.rootOptions,
      this.featureOptions,
      options,
    );
    const store =
      options?.store ?? this.featureOptions?.store ?? this.rootOptions.store;

    return createActivityLogger({
      store,
      logOptions: mergedOptions,
    }).activity(logName);
  }
}
