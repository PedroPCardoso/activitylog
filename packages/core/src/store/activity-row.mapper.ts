import type { Activity, ActivityId, ActivityProperties } from '../types/activity.types';
import type { SqlRow } from '../sql/datasource.types';

export function mapActivityRow(row: SqlRow): Activity {
  return {
    id: row.id as ActivityId,
    logName: requiredString(row.log_name, 'log_name'),
    description: requiredString(row.description, 'description'),
    subject: mapRef(row.subject_type, row.subject_id),
    causer: mapRef(row.causer_type, row.causer_id),
    event: nullableString(row.event),
    properties: parseProperties(row.properties),
    batchUuid: nullableString(row.batch_uuid),
    createdAt: parseDate(row.created_at),
  };
}

function mapRef(type: unknown, id: unknown): { type: string; id: string } | null {
  const resolvedType = nullableString(type);
  const resolvedId = nullableString(id);

  return resolvedType === null || resolvedId === null ? null : { type: resolvedType, id: resolvedId };
}

function parseProperties(value: unknown): ActivityProperties {
  if (typeof value === 'string') {
    return JSON.parse(value) as ActivityProperties;
  }

  return value === null || typeof value !== 'object' ? {} : (value as ActivityProperties);
}

function parseDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(requiredString(value, 'created_at'));
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`activitylog: expected a string in column "${column}"`);
  }

  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
