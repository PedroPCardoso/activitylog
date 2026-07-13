import type { NewActivity } from '../types/activity.types';

export function redactActivity(activity: NewActivity, fields: readonly string[] | false): NewActivity {
  if (fields === false) {
    return activity;
  }

  const sensitive = new Set(fields.map((field) => field.toLocaleLowerCase()));

  return {
    ...activity,
    properties: redactValue(activity.properties, sensitive) as NewActivity['properties'],
  };
}

function redactValue(value: unknown, sensitive: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, sensitive));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitive.has(key.toLocaleLowerCase()) ? '[REDACTED]' : redactValue(nested, sensitive),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
