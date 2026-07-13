import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests live at the repo root and run against package SOURCE (not built dist)
// via these aliases, so the whole workspace is exercised in one vitest run.
const r = (p: string) => resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^activitylog-core$/, replacement: r('packages/core/src/index.ts') },
      { find: /^activitylog-nestjs\/typeorm$/, replacement: r('packages/activitylog-nestjs/src/typeorm/index.ts') },
      { find: /^activitylog-nestjs$/, replacement: r('packages/activitylog-nestjs/src/index.ts') },
      { find: /^activitylog-nextjs\/prisma$/, replacement: r('packages/activitylog-nextjs/src/prisma/index.ts') },
      { find: /^activitylog-nextjs\/drizzle$/, replacement: r('packages/activitylog-nextjs/src/drizzle/index.ts') },
      { find: /^activitylog-nextjs$/, replacement: r('packages/activitylog-nextjs/src/index.ts') },
      { find: /^@core\/(.*)$/, replacement: r('packages/core/src') + '/$1' },
    ],
  },
  test: {
    include: ['test/**/*.spec.ts'],
    globals: false,
    // External DB specs will share persistent databases; serialize files so
    // future dialect tests cannot truncate each other.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/core/src/**/*.ts'],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
