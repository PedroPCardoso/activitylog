import type { LogOptions } from 'activitylog-core';

const activityOptions = new WeakMap<object, Readonly<LogOptions>>();

export function LogsActivity(options: LogOptions = {}): ClassDecorator {
  const frozenOptions = freezeOptions(options);

  return (target) => {
    activityOptions.set(target, frozenOptions);
  };
}

export function getLogsActivityOptions(target: object | string): Readonly<LogOptions> | undefined {
  return typeof target === 'object' || typeof target === 'function' ? activityOptions.get(target) : undefined;
}

function freezeOptions(options: LogOptions): Readonly<LogOptions> {
  const cloned = { ...options };

  if (options.logOnly !== undefined) {
    cloned.logOnly = Object.freeze([...options.logOnly]);
  }
  if (options.logExcept !== undefined) {
    cloned.logExcept = Object.freeze([...options.logExcept]);
  }
  if (Array.isArray(options.redact)) {
    cloned.redact = Object.freeze([...options.redact]);
  }

  return Object.freeze(cloned);
}
