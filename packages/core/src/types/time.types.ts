export type CreatedAtSource = 'application';
export type CreatedAtStorage = 'utc';
export type ActivityOrderColumn = 'createdAt' | 'id';

export interface CreatedAtPolicy {
  source: CreatedAtSource;
  storage: CreatedAtStorage;
  precision: 'milliseconds';
  stableOrder: readonly ['createdAt', 'id'];
}

export const CREATED_AT_POLICY: CreatedAtPolicy = {
  source: 'application',
  storage: 'utc',
  precision: 'milliseconds',
  stableOrder: ['createdAt', 'id'],
};

export function createActivityTimestamp(now: Date = new Date()): Date {
  return new Date(now.toISOString());
}
