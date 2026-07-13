import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import { ACTIVITYLOG_ROOT_OPTIONS } from './activity-log.constants';
import {
  runWithRequestContext,
  type ActivityLogRequest,
} from './activity-log.request';
import type { ActivityLogModuleOptions } from './activity-log.types';

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(
    @Inject(ACTIVITYLOG_ROOT_OPTIONS)
    private readonly options: ActivityLogModuleOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ActivityLogRequest>();

    return new Observable((subscriber) =>
      runWithRequestContext(
        request,
        this.options.causerResolver,
        () => next.handle().subscribe(subscriber),
      ),
    );
  }
}
