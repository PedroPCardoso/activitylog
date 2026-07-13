export type ActivityId = string | number | bigint;

export interface EntityRef<Type extends string = string, Id extends ActivityId = ActivityId> {
  type: Type;
  id: Id;
}

export type SubjectRef<Type extends string = string, Id extends ActivityId = ActivityId> = EntityRef<Type, Id>;
export type CauserRef<Type extends string = string, Id extends ActivityId = ActivityId> = EntityRef<Type, Id>;

export interface AggregateSubjectRef<Type extends string = string> {
  type: Type;
  id: null;
}

export type ActivitySubjectRef<Type extends string = string> = SubjectRef<Type> | AggregateSubjectRef<Type>;

export type ActivityEvent = 'created' | 'updated' | 'deleted' | 'restored' | string;

export interface ActivityProperties {
  attributes?: Record<string, unknown>;
  old?: Record<string, unknown>;
  aggregate?: boolean;
  [key: string]: unknown;
}

export interface Activity {
  id: ActivityId;
  logName: string;
  description: string;
  subject: ActivitySubjectRef | null;
  causer: CauserRef | null;
  event: ActivityEvent | null;
  properties: ActivityProperties;
  batchUuid: string | null;
  createdAt: Date;
}

export type NewActivity = Omit<Activity, 'id'> & {
  id?: ActivityId;
};

export function subjectRef<Type extends string, Id extends ActivityId>(
  type: Type,
  id: Id,
): SubjectRef<Type, Id> {
  return { type, id };
}

export function aggregateSubjectRef<Type extends string>(type: Type): AggregateSubjectRef<Type> {
  return { type, id: null };
}

export function causerRef<Type extends string, Id extends ActivityId>(
  type: Type,
  id: Id,
): CauserRef<Type, Id> {
  return { type, id };
}
