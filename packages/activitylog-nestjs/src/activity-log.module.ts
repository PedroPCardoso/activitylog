import { Module, type DynamicModule } from '@nestjs/common';

import {
  ACTIVITYLOG_FEATURE_OPTIONS,
  ACTIVITYLOG_ROOT_OPTIONS,
} from './activity-log.constants';
import { ActivityLogService } from './activity-log.service';
import type {
  ActivityLogFeatureOptions,
  ActivityLogModuleOptions,
} from './activity-log.types';

@Module({})
class ActivityLogFeatureModule {}

@Module({})
export class ActivityLogModule {
  static forRoot(options: ActivityLogModuleOptions): DynamicModule {
    return {
      module: ActivityLogModule,
      global: true,
      providers: [
        {
          provide: ACTIVITYLOG_ROOT_OPTIONS,
          useValue: options,
        },
        ActivityLogService,
      ],
      exports: [ACTIVITYLOG_ROOT_OPTIONS, ActivityLogService],
    };
  }

  static forFeature(options: ActivityLogFeatureOptions): DynamicModule {
    return {
      module: ActivityLogFeatureModule,
      providers: [
        {
          provide: ACTIVITYLOG_FEATURE_OPTIONS,
          useValue: options,
        },
        ActivityLogService,
      ],
      exports: [ActivityLogService],
    };
  }
}
