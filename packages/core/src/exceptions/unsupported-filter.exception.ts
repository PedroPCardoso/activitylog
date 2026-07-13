import { ActivityLogException } from './activitylog.exception';

export class UnsupportedActivityFilterException extends ActivityLogException {
  constructor(filter: string) {
    super(`activity filter "${filter}" is not supported by this store`);
  }
}
