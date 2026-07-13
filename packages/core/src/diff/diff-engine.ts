import { isDeepStrictEqual } from 'node:util';

import type { DiffSnapshot, LogOptions, ResolvedLogOptions } from '../types/log-options.types';

export interface DiffInput {
  old: Readonly<Record<string, unknown>>;
  attributes: Readonly<Record<string, unknown>>;
  dirty?: readonly string[];
  options?: Pick<LogOptions, 'logOnly' | 'logExcept' | 'logOnlyDirty'>
    | Pick<ResolvedLogOptions, 'logOnly' | 'logExcept' | 'logOnlyDirty'>;
}

export class DiffEngine {
  static diff(input: DiffInput): DiffSnapshot {
    const candidates = selectedKeys(input);
    const attributes: Record<string, unknown> = {};
    const old: Record<string, unknown> = {};

    for (const key of candidates) {
      const hasAttribute = Object.prototype.hasOwnProperty.call(input.attributes, key);
      const hasOld = Object.prototype.hasOwnProperty.call(input.old, key);

      if (input.options?.logOnlyDirty === true) {
        if (!hasAttribute || !hasOld || isDeepStrictEqual(input.attributes[key], input.old[key])) {
          if (hasAttribute === hasOld) continue;
        }
      }

      if (hasAttribute) attributes[key] = input.attributes[key];
      if (hasOld) old[key] = input.old[key];
    }

    return { attributes, old };
  }
}

function selectedKeys(input: DiffInput): readonly string[] {
  const available = new Set([...Object.keys(input.old), ...Object.keys(input.attributes)]);
  const only = input.options?.logOnly;
  const except = new Set(input.options?.logExcept ?? []);
  const dirty = input.options?.logOnlyDirty === true && input.dirty !== undefined
    ? new Set(input.dirty)
    : undefined;

  return (only ?? [...available])
    .filter((key) => available.has(key) && !except.has(key) && (dirty === undefined || dirty.has(key)));
}
