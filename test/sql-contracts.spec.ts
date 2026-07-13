import { describe, expect, it } from 'vitest';

import {
  InvalidIdentifierException,
  assertSafeIdentifier,
  dialectFor,
} from 'activitylog-core';

describe('SQL contracts', () => {
  it('quotes identifiers and creates placeholders for every dialect', () => {
    expect(dialectFor('postgres').placeholder(2)).toBe('$2');
    expect(dialectFor('mysql').escapeIdentifier('activity_log')).toBe('`activity_log`');
    expect(dialectFor('sqlite').escapeIdentifier('activity_log')).toBe('"activity_log"');
  });

  it('rejects unsafe identifiers with the public error prefix', () => {
    expect(() => assertSafeIdentifier('activity_log; DROP TABLE users')).toThrow(
      InvalidIdentifierException,
    );
    expect(() => assertSafeIdentifier('activity_log; DROP TABLE users')).toThrow(/^activitylog:/);
  });
});
