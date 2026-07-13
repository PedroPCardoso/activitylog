import { ActivityLogException } from './activitylog.exception';

export class InvalidActivityDateException extends ActivityLogException {
  constructor() {
    super('activity dates must be valid Date instances');
  }
}
