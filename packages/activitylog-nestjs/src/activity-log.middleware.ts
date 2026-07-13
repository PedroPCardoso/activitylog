import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { activityLogContextStorage } from 'activitylog-core';

import { ACTIVITYLOG_ROOT_OPTIONS } from './activity-log.constants';
import {
  resolveRequestCauser,
  type ActivityLogRequest,
} from './activity-log.request';
import type { ActivityLogModuleOptions } from './activity-log.types';

@Injectable()
export class ActivityLogMiddleware implements NestMiddleware {
  constructor(
    @Inject(ACTIVITYLOG_ROOT_OPTIONS)
    private readonly options: ActivityLogModuleOptions,
  ) {}

  use(
    request: ActivityLogRequest,
    _response: unknown,
    next: (error?: unknown) => void,
  ): void {
    activityLogContextStorage.run(
      {
        causerResolver: () =>
          resolveRequestCauser(request, this.options.causerResolver),
      },
      next,
    );
  }
}
