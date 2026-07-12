import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/typeorm/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  external: ['activitylog-core'],
});
