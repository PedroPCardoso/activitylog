import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';

import {
  ACTIVITYLOG_FEATURE_OPTIONS,
  ACTIVITYLOG_ROOT_OPTIONS,
} from './activity-log.constants';
import { ActivityLogInterceptor } from './activity-log.interceptor';
import { ActivityLogMiddleware } from './activity-log.middleware';
import { ActivityLogService } from './activity-log.service';
import type {
  ActivityLogFeatureOptions,
  ActivityLogModuleOptions,
} from './activity-log.types';

@Module({})
class ActivityLogFeatureModule {}

@Module({})
export class ActivityLogModule implements NestModule {
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
        ActivityLogMiddleware,
        ActivityLogInterceptor,
      ],
      exports: [
        ACTIVITYLOG_ROOT_OPTIONS,
        ActivityLogService,
        ActivityLogMiddleware,
        ActivityLogInterceptor,
      ],
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

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActivityLogMiddleware).forRoutes('*');
  }
}
