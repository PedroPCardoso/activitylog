export class ActivityLogException extends Error {
  constructor(message: string) {
    super(`activitylog: ${message}`);
    this.name = new.target.name;
  }
}
