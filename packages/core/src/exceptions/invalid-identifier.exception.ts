import { ActivityLogException } from './activitylog.exception';

export class InvalidIdentifierException extends ActivityLogException {
  constructor(identifier: string) {
    super(`invalid SQL identifier "${identifier}"`);
  }
}
