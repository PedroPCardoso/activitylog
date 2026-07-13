const PRISMA_NULLS = new Set(['DbNull', 'JsonNull', 'AnyNull']);

export function normalizePrismaValue(value: unknown): unknown {
  return normalize(value, new WeakSet(), 'value');
}

function normalize(value: unknown, ancestors: WeakSet<object>, location: 'value' | 'array'): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('cannot normalize a non-finite number');
    }
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (value === undefined) {
    return location === 'array' ? null : undefined;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    fail(`cannot normalize a ${typeof value}`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      fail('cannot normalize an invalid Date');
    }
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString('base64') };
  }

  const constructorName = value.constructor?.name;
  if (/^Decimal\d*$/.test(constructorName ?? '') && typeof (value as { toString?: unknown }).toString === 'function') {
    return String(value);
  }
  if (constructorName !== undefined && PRISMA_NULLS.has(constructorName)) {
    return { $prismaNull: constructorName };
  }

  if (ancestors.has(value)) {
    fail('cannot normalize a cyclic value');
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalize(item, ancestors, 'array'));
    }
    if (!isPlainObject(value)) {
      fail(`cannot normalize an unsupported ${constructorName ?? 'object'} instance`);
    }

    return Object.fromEntries(
      Object.entries(value)
        .map(([key, nested]) => [key, normalize(nested, ancestors, 'value')] as const)
        .filter(([, nested]) => nested !== undefined),
    );
  } finally {
    ancestors.delete(value);
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(message: string): never {
  throw new TypeError(`activitylog: Prisma adapter ${message}`);
}
