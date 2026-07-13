'use strict';

const { execFileSync } = require('node:child_process');

const prismaCli = require.resolve('prisma/build/index.js');
const schemas = [
  'test/fixtures/prisma/schema.prisma',
  'test/fixtures/prisma/schema.postgresql.prisma',
];

for (const schema of schemas) {
  execFileSync(process.execPath, [prismaCli, 'generate', '--schema', schema], {
    stdio: 'inherit',
  });
}
