import { describe, expect, it } from 'vitest';

import { activityLogContextStorage as coreStorage } from 'activitylog-core';
import { activityLogContextStorage as nestStorage } from 'activitylog-nestjs';
import { activityLogContextStorage as typeormStorage } from 'activitylog-nestjs/typeorm';
import { activityLogContextStorage as nextStorage } from 'activitylog-nextjs';
import { activityLogContextStorage as prismaStorage } from 'activitylog-nextjs/prisma';
import { activityLogContextStorage as drizzleStorage } from 'activitylog-nextjs/drizzle';

describe('activitylog-core singleton', () => {
  it('is shared by every leaf package and subpath', () => {
    expect(nestStorage).toBe(coreStorage);
    expect(typeormStorage).toBe(coreStorage);
    expect(nextStorage).toBe(coreStorage);
    expect(prismaStorage).toBe(coreStorage);
    expect(drizzleStorage).toBe(coreStorage);
  });
});
